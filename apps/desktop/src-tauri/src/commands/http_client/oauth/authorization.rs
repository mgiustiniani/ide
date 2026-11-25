//! Authorization Code with native-owned S256 verifier and a temporary loopback receiver.
use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener, TcpStream},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
const DEADLINE: Duration = Duration::from_secs(300);
const CALLBACK_PATH: &str = "/oauth/callback";
const RETIRED: &str =
    "The OAuth sign-in expired, was cancelled, or belongs to a retired workspace.";
static ACTIVE: Mutex<Option<Arc<Login>>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    workspace_id: String,
    generation: u64,
    request_id: String,
    authorization_url: String,
    token_url: String,
    issuer: String,
    client_id: String,
    client_secret: String,
    client_authentication: ClientAuthentication,
    scope: String,
    allow_loopback_http: bool,
    callback_port: u16,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ClientAuthentication {
    None,
    Basic,
    Body,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    session_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    workspace_id: String,
    generation: u64,
    request_id: String,
    session_id: String,
    redirect_uri: String,
    expires_in: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completed {
    #[serde(flatten)]
    token: TokenResult,
    session_id: String,
    expires_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cancelled {
    #[serde(flatten)]
    scope: SessionRequest,
    cancelled: bool,
}
struct Login {
    id: String,
    request: Start,
    binding: CurrentWorkspaceBinding,
    epoch: u64,
    redirect_uri: String,
    state: String,
    verifier: String,
    created: Instant,
    cancelled: AtomicBool,
    completing: AtomicBool,
    finished: AtomicBool,
    listener_closed: AtomicBool,
    callback: Mutex<Option<mpsc::Receiver<Result<String, String>>>>,
}
impl Drop for Login {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}
fn nonce(bytes: usize) -> Result<String, String> {
    let mut value = vec![0; bytes];
    getrandom::fill(&mut value).map_err(|_| "Cannot prepare OAuth sign-in.")?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn endpoint(value: &str, allow_loopback: bool) -> Result<Url, String> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("Invalid OAuth endpoint.".into());
    }
    let url = Url::parse(value).map_err(|_| "Enter an absolute OAuth HTTPS endpoint.")?;
    let loopback = url
        .host_str()
        .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    if url.host().is_none()
        || (url.scheme() != "https" && !(url.scheme() == "http" && loopback && allow_loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("OAuth requires HTTPS without URL credentials or fragments; enable numeric-loopback HTTP only for local development.".into());
    }
    Ok(url)
}
fn validate(request: &Start) -> Result<(), String> {
    let auth = endpoint(&request.authorization_url, request.allow_loopback_http)?;
    endpoint(&request.token_url, request.allow_loopback_http)?;
    let issuer = endpoint(&request.issuer, request.allow_loopback_http)?;
    if issuer.query().is_some() {
        return Err("The OAuth issuer cannot contain query parameters.".into());
    }
    let reserved = [
        "response_type",
        "client_id",
        "redirect_uri",
        "scope",
        "state",
        "code_challenge",
        "code_challenge_method",
        "response_mode",
        "request",
        "request_uri",
    ];
    if auth
        .query_pairs()
        .any(|(name, _)| reserved.contains(&name.as_ref()))
    {
        return Err("Remove OAuth flow parameters from the authorization endpoint URL; the IDE supplies them.".into());
    }
    if request.client_id.is_empty()
        || request.client_id.len() > 8192
        || request.client_secret.len() > 8192
        || request
            .client_id
            .chars()
            .chain(request.client_secret.chars())
            .any(char::is_control)
        || !scope_valid(&request.scope)
        || (request.callback_port != 0 && request.callback_port < 1024)
        || (!matches!(request.client_authentication, ClientAuthentication::None)
            && request.client_secret.is_empty())
        || (matches!(request.client_authentication, ClientAuthentication::None)
            && !request.client_secret.is_empty())
    {
        return Err("Enter valid OAuth client settings, scopes and an available unprivileged callback port (or 0).".into());
    }
    if matches!(request.client_authentication, ClientAuthentication::Basic)
        && format!(
            "Basic {}",
            BASE64.encode(format!(
                "{}:{}",
                form_component(&request.client_id),
                form_component(&request.client_secret)
            ))
        )
        .len()
            > MAX_TOKEN
    {
        return Err("Encoded OAuth client authentication exceeds 16 KiB.".into());
    }
    if request.workspace_id.is_empty()
        || request.workspace_id.len() > 256
        || request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.request_id.chars().any(char::is_control)
    {
        return Err("Invalid OAuth sign-in identity.".into());
    }
    Ok(())
}
fn bind(port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .or_else(|_| TcpListener::bind((Ipv6Addr::LOCALHOST, port)))
        .map_err(|_| "The OAuth loopback callback port is unavailable.".to_owned())
        .and_then(|listener| {
            listener
                .set_nonblocking(true)
                .map_err(|_| "Cannot prepare the OAuth callback listener.")?;
            Ok(listener)
        })
}
fn authorization_url(
    request: &Start,
    redirect: &str,
    state: &str,
    verifier: &str,
) -> Result<Url, String> {
    let mut url = endpoint(&request.authorization_url, request.allow_loopback_http)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &request.client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("state", state)
        .append_pair("code_challenge", &challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("response_mode", "query");
    if !request.scope.is_empty() {
        url.query_pairs_mut().append_pair("scope", &request.scope);
    }
    if url.as_str().len() > 32768 {
        return Err("The OAuth authorization URL is too long.".into());
    }
    Ok(url)
}
fn current(login: &Login) -> Result<(), String> {
    if login.cancelled.load(Ordering::Acquire) || login.created.elapsed() >= DEADLINE {
        return Err(RETIRED.into());
    }
    check(&login.binding, login.epoch).map_err(|_| RETIRED.to_owned())
}
fn session_matches(login: &Login, request: &SessionRequest) -> bool {
    login.id == request.session_id
        && login.request.workspace_id == request.workspace_id
        && login.request.generation == request.generation
}
fn capture(request: &Start) -> Result<(CurrentWorkspaceBinding, u64), String> {
    workspace_registry::with_root_activation(|| {
        let binding = workspace_registry::current_workspace_binding_at(
            &workspace::workspace_root()?,
            &app_config::workspace_registry_path()?,
        )?;
        if binding.workspace_id != request.workspace_id {
            return Err(RETIRED.into());
        }
        Ok((binding, workspace_registry::active_workspace_generation()))
    })
}
fn install(
    request: Start,
    binding: CurrentWorkspaceBinding,
    epoch: u64,
) -> Result<
    (
        Arc<Login>,
        TcpListener,
        Url,
        mpsc::Sender<Result<String, String>>,
    ),
    String,
> {
    let mut active = ACTIVE.lock().map_err(|_| RETIRED)?;
    if let Some(old) = active.as_ref() {
        if !old.finished.load(Ordering::Acquire) && current(old).is_ok() {
            return Err(
                "Another OAuth sign-in is already pending. Complete or cancel it first.".into(),
            );
        }
        old.cancelled.store(true, Ordering::Release);
    }
    let listener = bind(request.callback_port)?;
    let redirect = format!(
        "http://{}{CALLBACK_PATH}",
        listener.local_addr().map_err(|_| RETIRED)?
    );
    let state = nonce(32)?;
    let verifier = nonce(32)?;
    let url = authorization_url(&request, &redirect, &state, &verifier)?;
    let (sender, receiver) = mpsc::channel();
    let login = Arc::new(Login {
        id: nonce(24)?,
        request,
        binding,
        epoch,
        redirect_uri: redirect,
        state,
        verifier,
        created: Instant::now(),
        cancelled: AtomicBool::new(false),
        completing: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        listener_closed: AtomicBool::new(false),
        callback: Mutex::new(Some(receiver)),
    });
    *active = Some(login.clone());
    Ok((login, listener, url, sender))
}
fn retire(login: &Arc<Login>) {
    login.cancelled.store(true, Ordering::Release);
    login.finished.store(true, Ordering::Release);
    if let Ok(mut active) = ACTIVE.lock() {
        if active
            .as_ref()
            .is_some_and(|value| Arc::ptr_eq(value, login))
        {
            *active = None;
        }
    }
}
fn launch_browser(url: &Url) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let mut command = Command::new("/usr/bin/xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = Command::new("rundll32.exe");
        value.arg("url.dll,FileProtocolHandler");
        value
    };
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    return Err("External OAuth browser launch is unavailable on this operating system.".into());
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        #[cfg(target_os = "linux")]
        command
            .env_remove("LD_LIBRARY_PATH")
            .env_remove("LD_PRELOAD");
        let mut child = command
            .arg(url.as_str())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Cannot request sign-in in the external browser.")?;
        thread::sleep(Duration::from_millis(100));
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => {
                Err("The system browser launcher refused the OAuth URL.".into())
            }
            Ok(Some(_)) => Ok(()),
            Ok(None) => {
                thread::spawn(move || {
                    let _ = child.wait();
                });
                Ok(())
            }
            Err(_) => {
                thread::spawn(move || {
                    let _ = child.wait();
                });
                Err("Cannot confirm the external browser launch request.".into())
            }
        }
    }
}

/// Parse only an origin-form GET for this exact loopback endpoint. No callback input is echoed.
fn callback(
    headers: &str,
    redirect: &str,
    state: &str,
    issuer: &str,
) -> Result<Result<String, String>, String> {
    if headers.len() > 16 * 1024 || !headers.ends_with("\r\n\r\n") {
        return Err("Invalid callback framing.".into());
    }
    let mut lines = headers.split("\r\n");
    let line = lines.next().ok_or(RETIRED)?;
    let parts = line.split(' ').collect::<Vec<_>>();
    if parts.len() != 3
        || parts[0] != "GET"
        || parts[2] != "HTTP/1.1"
        || !parts[1].starts_with('/')
        || parts[1].starts_with("//")
        || parts[1].len() > 8192
    {
        return Err("Invalid callback request.".into());
    }
    let mut host = None;
    let mut count = 0;
    for line in lines.filter(|line| !line.is_empty()) {
        count += 1;
        if count > 64 || line.starts_with([' ', '\t']) {
            return Err("Invalid callback headers.".into());
        }
        let (name, value) = line.split_once(':').ok_or("Invalid callback header.")?;
        if name.eq_ignore_ascii_case("host") {
            if host.replace(value.trim()).is_some() {
                return Err("Duplicate callback Host.".into());
            }
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || (name.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err("Callback bodies are unsupported.".into());
        }
    }
    let expected = Url::parse(redirect).map_err(|_| RETIRED)?;
    if host != Some(&redirect[7..redirect.len() - CALLBACK_PATH.len()]) {
        return Err("Wrong callback Host.".into());
    }
    let (path, query) = parts[1]
        .split_once('?')
        .ok_or("Missing callback parameters.")?;
    if path != expected.path() {
        return Err("Wrong callback path.".into());
    }
    let mut fields = std::collections::BTreeMap::new();
    fn decode(value: &str) -> Result<String, String> {
        let bytes = value.as_bytes();
        let mut offset = 0;
        while offset < bytes.len() {
            if bytes[offset] == b'%' {
                if offset + 2 >= bytes.len()
                    || !bytes[offset + 1].is_ascii_hexdigit()
                    || !bytes[offset + 2].is_ascii_hexdigit()
                {
                    return Err("Invalid callback encoding.".into());
                }
                offset += 2;
            }
            offset += 1;
        }
        percent_encoding::percent_decode_str(&value.replace('+', " "))
            .decode_utf8()
            .map(|value| value.into_owned())
            .map_err(|_| "Invalid callback text.".into())
    }
    for field in query.split('&') {
        if fields.len() >= 32 {
            return Err("Too many callback parameters.".into());
        }
        let (name, value) = field.split_once('=').ok_or("Invalid callback parameter.")?;
        let name = decode(name)?;
        let value = decode(value)?;
        if value.len() > 8192 || fields.insert(name, value).is_some() {
            return Err("Duplicate or oversized callback parameters.".into());
        }
    }
    let received = fields.get("state").ok_or("Missing OAuth state.")?;
    if received.len() != state.len()
        || received
            .as_bytes()
            .iter()
            .zip(state.bytes())
            .fold(0u8, |value, (a, b)| value | (*a ^ b))
            != 0
    {
        return Err("OAuth state did not match.".into());
    }
    if fields.get("iss").map(String::as_str) != Some(issuer) {
        return Ok(Err("OAuth issuer verification failed. The provider must return the configured issuer in its authorization response.".into()));
    }
    if fields.contains_key("error") {
        return Ok(Err("The authorization server did not grant sign-in. Review its browser page before retrying.".into()));
    }
    if fields.contains_key("access_token") || fields.contains_key("id_token") {
        return Ok(Err(
            "Only an authorization code response is supported.".into()
        ));
    }
    let code = fields.remove("code").ok_or("Missing authorization code.")?;
    if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
        return Ok(Err("Invalid authorization code response.".into()));
    }
    Ok(Ok(code))
}
fn read_callback(
    stream: &mut TcpStream,
    redirect: &str,
    state: &str,
    issuer: &str,
) -> Result<Result<String, String>, String> {
    let until = Instant::now() + Duration::from_secs(1);
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| RETIRED)?;
    stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .map_err(|_| RETIRED)?;
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    loop {
        if Instant::now() >= until || bytes.len() >= 16 * 1024 {
            return Err("Callback headers exceeded their limit.".into());
        }
        match stream.read(&mut buffer) {
            Ok(0) => return Err("Incomplete callback request.".into()),
            Ok(length) => bytes.extend_from_slice(&buffer[..length]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                continue
            }
            Err(_) => return Err("Cannot read callback request.".into()),
        }
        if let Some(index) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            if index + 4 != bytes.len() {
                return Err("Callback bodies and pipelining are unsupported.".into());
            }
            return callback(
                std::str::from_utf8(&bytes).map_err(|_| "Invalid callback headers.")?,
                redirect,
                state,
                issuer,
            );
        }
    }
}
fn respond(stream: &mut TcpStream, accepted: bool) {
    let (status, body) = if accepted {
        ("200 OK","<!doctype html><title>OAuth sign-in</title><p>Sign-in response received. Close this browser tab and return to the IDE.</p>")
    } else {
        ("400 Bad Request","<!doctype html><title>OAuth sign-in</title><p>This sign-in response was refused. Return to the IDE to review or cancel sign-in.</p>")
    };
    let _=write!(stream,"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nPragma: no-cache\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\n\r\n{body}",body.len());
}
fn receive_callback(
    login: Arc<Login>,
    listener: TcpListener,
    sender: mpsc::Sender<Result<String, String>>,
) {
    let mut attempts = 0;
    loop {
        if current(&login).is_err() || attempts >= 32 {
            let _ = sender.send(Err(RETIRED.into()));
            break;
        }
        match listener.accept() {
            Ok((mut stream, address)) => {
                attempts += 1;
                if !address.ip().is_loopback() {
                    continue;
                }
                match read_callback(
                    &mut stream,
                    &login.redirect_uri,
                    &login.state,
                    &login.request.issuer,
                ) {
                    Ok(outcome) => {
                        respond(&mut stream, outcome.is_ok());
                        let _ = sender.send(outcome);
                        break;
                    }
                    Err(_) => respond(&mut stream, false),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25))
            }
            Err(_) => {
                let _ = sender.send(Err(RETIRED.into()));
                break;
            }
        }
    }
    drop(listener);
    login.listener_closed.store(true, Ordering::Release);
    // A valid code can wait briefly for the renderer's completion command. Never retain
    // an abandoned verifier past the flow deadline after closing its listener.
    while !login.finished.load(Ordering::Acquire) && current(&login).is_ok() {
        thread::sleep(Duration::from_millis(25));
    }
    retire(&login);
}
fn wait_code(login: &Arc<Login>) -> Result<String, String> {
    let receiver = login
        .callback
        .lock()
        .map_err(|_| RETIRED)?
        .take()
        .ok_or(RETIRED)?;
    loop {
        current(login)?;
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => {
                current(login)?;
                return value;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return Err(RETIRED.into()),
        }
    }
}
fn exchange_request(
    login: &Login,
    scope: &SessionRequest,
    code: &str,
) -> Result<ValidatedRequest, String> {
    let request = &login.request;
    let mut fields = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", login.redirect_uri.as_str()),
        ("code_verifier", login.verifier.as_str()),
    ];
    let mut headers = vec![
        HttpRequestHeader {
            name: "Content-Type".into(),
            value: "application/x-www-form-urlencoded".into(),
        },
        HttpRequestHeader {
            name: "Accept".into(),
            value: "application/json".into(),
        },
    ];
    match request.client_authentication {
        ClientAuthentication::None => fields.push(("client_id", &request.client_id)),
        ClientAuthentication::Basic => {
            let value = format!(
                "Basic {}",
                BASE64.encode(format!(
                    "{}:{}",
                    form_component(&request.client_id),
                    form_component(&request.client_secret)
                ))
            );
            if value.len() > MAX_TOKEN {
                return Err("Encoded OAuth client authentication exceeds 16 KiB.".into());
            }
            headers.push(HttpRequestHeader {
                name: "Authorization".into(),
                value,
            });
        }
        ClientAuthentication::Body => {
            fields.push(("client_id", &request.client_id));
            fields.push(("client_secret", &request.client_secret));
        }
    }
    let encoded =
        Url::parse_with_params("https://encoding.invalid/", fields).map_err(|_| FAILED)?;
    let mut prepared = validate_request(HttpRequestSubmission {
        workspace_id: scope.workspace_id.clone(),
        generation: scope.generation,
        request_id: scope.request_id.clone(),
        method: "POST".into(),
        url: request.token_url.clone(),
        headers,
        body: encoded.query().unwrap_or_default().into(),
        http_version: None,
        redirect_policy: Some("none".into()),
    })
    .map_err(|_| FAILED)?;
    for value in prepared.headers.values_mut() {
        value.set_sensitive(true);
    }
    Ok(prepared)
}
fn validate_session(request: &SessionRequest) -> Result<(), String> {
    if request.session_id.len() != 32
        || !request
            .session_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"-_".contains(&value))
        || request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.request_id.chars().any(char::is_control)
    {
        return Err(RETIRED.into());
    }
    Ok(())
}
#[tauri::command]
pub async fn begin_oauth_authorization(
    window: WebviewWindow,
    request: Start,
) -> Result<Session, String> {
    if window.label() != "main" {
        return Err("OAuth sign-in requires the main window.".into());
    }
    validate(&request)?;
    let (binding, epoch) = capture(&request)?;
    super::super::super::blocking::run(move || {
        let (login, listener, url, sender) = install(request, binding, epoch)?;
        let worker = login.clone();
        if thread::Builder::new()
            .name("oauth-callback".into())
            .spawn(move || receive_callback(worker, listener, sender))
            .is_err()
        {
            retire(&login);
            return Err("Cannot start the OAuth callback listener.".into());
        }
        let result = (|| {
            current(&login)?;
            launch_browser(&url)?;
            current(&login)?;
            Ok(Session {
                workspace_id: login.request.workspace_id.clone(),
                generation: login.request.generation,
                request_id: login.request.request_id.clone(),
                session_id: login.id.clone(),
                redirect_uri: login.redirect_uri.clone(),
                expires_in: DEADLINE.as_secs(),
            })
        })();
        if result.is_err() {
            retire(&login);
        }
        result
    })
    .await
}
#[tauri::command]
pub async fn complete_oauth_authorization(
    window: WebviewWindow,
    request: SessionRequest,
) -> Result<Completed, String> {
    if window.label() != "main" {
        return Err("OAuth sign-in requires the main window.".into());
    }
    validate_session(&request)?;
    let login = ACTIVE
        .lock()
        .map_err(|_| RETIRED)?
        .as_ref()
        .filter(|login| session_matches(login, &request))
        .cloned()
        .ok_or(RETIRED)?;
    if login.completing.swap(true, Ordering::AcqRel) {
        return Err("OAuth sign-in completion is already pending.".into());
    }
    let result = async {
        let captured = login.clone();
        let code = super::super::super::blocking::run(move || wait_code(&captured)).await?;
        current(&login)?;
        let prepared = exchange_request(&login, &request, &code)?;
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| FAILED)?
            .as_millis();
        let token = acquire(prepared).await?;
        current(&login)?;
        let expires_at = token
            .expires_in
            .map(|seconds| started + u128::from(seconds) * 1000)
            .map(|value| u64::try_from(value).map_err(|_| FAILED))
            .transpose()?;
        Ok(Completed {
            token,
            session_id: login.id.clone(),
            expires_at,
        })
    }
    .await;
    retire(&login);
    result
}
#[tauri::command]
pub async fn cancel_oauth_authorization(
    window: WebviewWindow,
    request: SessionRequest,
) -> Result<Cancelled, String> {
    if window.label() != "main" {
        return Err("OAuth sign-in requires the main window.".into());
    }
    validate_session(&request)?;
    let login = ACTIVE
        .lock()
        .map_err(|_| RETIRED)?
        .as_ref()
        .filter(|login| session_matches(login, &request))
        .cloned();
    if let Some(login) = login {
        retire(&login);
        super::super::super::blocking::run(move || {
            let until = Instant::now() + Duration::from_secs(2);
            while !login.listener_closed.load(Ordering::Acquire) && Instant::now() < until {
                thread::sleep(Duration::from_millis(10));
            }
            if !login.listener_closed.load(Ordering::Acquire) {
                return Err(
                    "OAuth sign-in was retired but callback listener closure is not yet confirmed."
                        .into(),
                );
            }
            Ok(())
        })
        .await?;
    }
    Ok(Cancelled {
        scope: request,
        cancelled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn start() -> Start {
        serde_json::from_value(serde_json::json!({"workspaceId":"ws-fixture","generation":2,"requestId":"start-fixture","authorizationUrl":"https://identity.example.test/authorize?tenant=fixture","tokenUrl":"https://identity.example.test/token","issuer":"https://identity.example.test/","clientId":"client:é +","clientSecret":"","clientAuthentication":"none","scope":"openid profile","allowLoopbackHttp":false,"callbackPort":0})).unwrap()
    }
    fn raw(query: &str) -> String {
        format!("GET /oauth/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:12345\r\n\r\n")
    }
    const REDIRECT: &str = "http://127.0.0.1:12345/oauth/callback";
    const ISSUER: &str = "https://identity.example.test/";
    #[test]
    fn s256_matches_rfc_vector_and_authorization_parameters_never_contain_a_verifier_or_secret() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let request = start();
        validate(&request).unwrap();
        let url = authorization_url(&request, REDIRECT, "state-fixture", verifier).unwrap();
        let fields = url
            .query_pairs()
            .into_owned()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(fields["code_challenge_method"], "S256");
        assert_eq!(fields["code_challenge"], challenge(verifier));
        assert_eq!(fields["redirect_uri"], REDIRECT);
        assert_eq!(fields["client_id"], "client:é +");
        assert_eq!(fields["tenant"], "fixture");
        assert!(!url.as_str().contains(verifier));
        assert!(!fields.contains_key("client_secret"));
        let value = nonce(32).unwrap();
        assert_eq!(value.len(), 43);
        assert!(value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"-_".contains(&value)));
    }
    #[test]
    fn endpoint_and_registration_validation_refuse_parameter_overrides_and_unsupported_client_settings(
    ) {
        for field in [
            "response_type",
            "client_id",
            "redirect_uri",
            "scope",
            "state",
            "code_challenge",
            "code_challenge_method",
            "response_mode",
            "request",
            "request_uri",
        ] {
            let mut request = start();
            request.authorization_url =
                format!("https://identity.example.test/authorize?{field}=untrusted");
            assert!(validate(&request).is_err());
        }
        let mut request = start();
        request.authorization_url = "http://identity.example.test/authorize".into();
        assert!(validate(&request).is_err());
        request = start();
        request.client_secret = "not-for-public-client".into();
        assert!(validate(&request).is_err());
        request = start();
        request.callback_port = 80;
        assert!(validate(&request).is_err());
        request = start();
        request.issuer = "https://identity.example.test/?tenant=fixture".into();
        assert!(validate(&request).is_err());
        request = start();
        request.allow_loopback_http = true;
        request.authorization_url = "http://127.0.0.1:12345/authorize".into();
        request.token_url = "http://127.0.0.1:12345/token".into();
        request.issuer = "http://127.0.0.1:12345".into();
        assert!(validate(&request).is_ok());
    }
    #[test]
    fn callback_requires_exact_state_host_path_and_issuer_and_refuses_duplicate_or_ambiguous_responses(
    ) {
        let query =
            "state=state-fixture&iss=https%3A%2F%2Fidentity.example.test%2F&code=opaque%2Bcode";
        assert_eq!(
            callback(&raw(query), REDIRECT, "state-fixture", ISSUER)
                .unwrap()
                .unwrap(),
            "opaque+code"
        );
        for altered in [
            query.replace("state-fixture", "wrong-state"),
            format!("{query}&%73tate=state-fixture"),
            format!("{query}&code=other"),
            query.replace("opaque%2Bcode", "%FF"),
            query.replace("opaque%2Bcode", "%XY"),
        ] {
            assert!(callback(&raw(&altered), REDIRECT, "state-fixture", ISSUER).is_err());
        }
        for altered in [
            raw(query).replace("Host: 127.0.0.1:12345", "Host: localhost:12345"),
            raw(query).replace("GET ", "POST "),
            raw(query).replace("/oauth/callback?", "//evil.example.test/?"),
            raw(query).replace("\r\n\r\n", "\r\nTransfer-Encoding: chunked\r\n\r\n"),
        ] {
            assert!(callback(&altered, REDIRECT, "state-fixture", ISSUER).is_err());
        }
        let wrong_issuer = query.replace("identity.example.test", "wrong.example.test");
        assert!(
            callback(&raw(&wrong_issuer), REDIRECT, "state-fixture", ISSUER)
                .unwrap()
                .is_err()
        );
        let missing_issuer = "state=state-fixture&code=opaque";
        assert!(
            callback(&raw(missing_issuer), REDIRECT, "state-fixture", ISSUER)
                .unwrap()
                .is_err()
        );
        let denied="state=state-fixture&iss=https%3A%2F%2Fidentity.example.test%2F&error=access_denied&error_description=private-description";
        let refusal = callback(&raw(denied), REDIRECT, "state-fixture", ISSUER)
            .unwrap()
            .unwrap_err();
        assert!(!refusal.contains("private-description"));
    }
    #[test]
    fn real_callback_reader_is_bounded_and_response_body_does_not_reflect_code_or_state() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let redirect = format!("http://{address}/oauth/callback");
        let thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let code = read_callback(&mut stream, &redirect, "state-fixture", ISSUER)
                .unwrap()
                .unwrap();
            respond(&mut stream, true);
            code
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(client,"GET /oauth/callback?state=state-fixture&iss=https%3A%2F%2Fidentity.example.test%2F&code=private-code HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
        let mut output = String::new();
        client.read_to_string(&mut output).unwrap();
        assert_eq!(thread.join().unwrap(), "private-code");
        assert!(output.contains("Cache-Control: no-store"));
        assert!(!output.contains("private-code"));
        assert!(!output.contains("state-fixture"));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let started = Instant::now();
            assert!(read_callback(
                &mut stream,
                &format!("http://{address}/oauth/callback"),
                "state-fixture",
                ISSUER
            )
            .is_err());
            assert!(started.elapsed() < Duration::from_secs(3));
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .write_all(b"GET /oauth/callback?state=state-fixture HTTP/1.1\r\n")
            .unwrap();
        thread.join().unwrap();
    }
    #[test]
    fn code_exchange_preserves_public_and_confidential_client_authentication_and_rejects_retired_sessions(
    ) {
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let fixture = Fixture(
            std::env::temp_dir().join(format!("ide-oauth-code-test-{}", nonce(16).unwrap())),
        );
        let root = fixture.0.join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let registry = fixture.0.join("registry.json");
        workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = workspace_registry::current_workspace_binding_at(&root, &registry).unwrap();
        let (_sender, receiver) = mpsc::channel();
        let mut login = Login {
            id: nonce(24).unwrap(),
            request: start(),
            binding,
            epoch: 0,
            redirect_uri: REDIRECT.into(),
            state: "state-fixture".into(),
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into(),
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            completing: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            listener_closed: AtomicBool::new(false),
            callback: Mutex::new(Some(receiver)),
        };
        let scope = SessionRequest {
            workspace_id: login.request.workspace_id.clone(),
            generation: login.request.generation,
            request_id: "complete-fixture".into(),
            session_id: login.id.clone(),
        };
        let parse = |request: &ValidatedRequest| {
            Url::parse(&format!(
                "https://form.invalid/?{}",
                String::from_utf8_lossy(&request.body)
            ))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect::<std::collections::BTreeMap<_, _>>()
        };
        let public = exchange_request(&login, &scope, "opaque:code +é").unwrap();
        let fields = parse(&public);
        assert_eq!(fields["code"], "opaque:code +é");
        assert_eq!(fields["code_verifier"], login.verifier);
        assert_eq!(fields["redirect_uri"], REDIRECT);
        assert_eq!(fields["client_id"], login.request.client_id);
        assert!(!fields.contains_key("client_secret"));
        assert!(!public.headers.contains_key("authorization"));
        assert!(public.no_redirects);
        login.request.client_secret = "secret:£ +&".into();
        login.request.client_authentication = ClientAuthentication::Basic;
        let basic = exchange_request(&login, &scope, "code").unwrap();
        assert_eq!(
            basic.headers["authorization"].to_str().unwrap(),
            format!(
                "Basic {}",
                BASE64.encode("client%3A%C3%A9+%2B:secret%3A%C2%A3+%2B%26")
            )
        );
        assert!(!parse(&basic).contains_key("client_secret"));
        login.request.client_authentication = ClientAuthentication::Body;
        let body = exchange_request(&login, &scope, "code").unwrap();
        assert!(!body.headers.contains_key("authorization"));
        assert_eq!(parse(&body)["client_secret"], "secret:£ +&");
        assert!(session_matches(&login, &scope));
        assert!(!session_matches(
            &login,
            &SessionRequest {
                generation: scope.generation + 1,
                ..scope
            }
        ));
        login.cancelled.store(true, Ordering::Release);
        assert!(current(&login).is_err());
        login.cancelled.store(false, Ordering::Release);
        login.created = Instant::now() - DEADLINE;
        assert!(current(&login).is_err());
    }
}
