//! Explicit, nonpersistent OAuth token acquisition through the bounded HTTP transport.
pub mod authorization;
use super::*;
use crate::commands::workspace_registry::{self, CurrentWorkspaceBinding};
use crate::{app_config, workspace};
use tauri::WebviewWindow;
const MAX_TOKEN_BODY: usize = 64 * 1024;
const MAX_TOKEN: usize = 16 * 1024;
const MAX_LIFETIME: u64 = 2_147_483_647;
const FAILED: &str = "OAuth token acquisition failed. Check the endpoint and client settings.";
const MALFORMED: &str = "The token endpoint returned an unsupported or malformed OAuth response.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    token_url: String,
    client_id: String,
    client_secret: String,
    scope: String,
    client_authentication: Authentication,
    allow_loopback_http: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Authentication {
    Basic,
    Body,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    access_token: String,
    token_type: &'static str,
    expires_in: Option<u64>,
    scope: Option<String>,
}
#[derive(Deserialize)]
struct TokenBody {
    access_token: String,
    token_type: String,
    expires_in: Option<u64>,
    scope: Option<String>,
    error: Option<String>,
}
fn scope_valid(scope: &str) -> bool {
    scope.len() <= 8192
        && (scope.is_empty()
            || scope.split(' ').all(|token| {
                !token.is_empty()
                    && token.bytes().all(|b| {
                        b == 0x21 || (0x23..=0x5b).contains(&b) || (0x5d..=0x7e).contains(&b)
                    })
            }))
}
fn token_valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= MAX_TOKEN && {
        let content = token.trim_end_matches('=');
        !content.is_empty()
            && content
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._~+/".contains(&b))
    }
}
fn form_component(value: &str) -> String {
    let encoded = reqwest::Url::parse_with_params("https://encoding.invalid/", &[("v", value)])
        .expect("constant URL");
    encoded
        .query()
        .unwrap_or("v=")
        .strip_prefix("v=")
        .unwrap_or("")
        .to_owned()
}
fn prepare(request: &TokenRequest) -> Result<ValidatedRequest, String> {
    for value in [&request.client_id, &request.client_secret] {
        if value.len() > 8192 || value.chars().any(char::is_control) {
            return Err(
                "OAuth client values must be bounded text without control characters.".into(),
            );
        }
    }
    if request.client_id.is_empty()
        || request.client_secret.is_empty()
        || !scope_valid(&request.scope)
    {
        return Err(
            "Enter a client ID, client secret and valid space-separated OAuth scopes.".into(),
        );
    }
    let url =
        Url::parse(&request.token_url).map_err(|_| "Enter a valid OAuth token endpoint URL.")?;
    let loopback = url
        .host_str()
        .and_then(|host| {
            host.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .ok()
        })
        .is_some_and(|ip| ip.is_loopback());
    if url.scheme() != "https"
        && !(url.scheme() == "http" && loopback && request.allow_loopback_http)
    {
        return Err("OAuth requires HTTPS. HTTP is allowed only for an explicitly enabled numeric loopback development endpoint.".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("OAuth endpoint URLs cannot contain credentials or fragments.".into());
    }
    let mut form = vec![
        ("grant_type", "client_credentials"),
        ("scope", request.scope.as_str()),
    ];
    if request.scope.is_empty() {
        form.pop();
    }
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
        Authentication::Basic => {
            let credentials = format!(
                "{}:{}",
                form_component(&request.client_id),
                form_component(&request.client_secret)
            );
            let value = format!("Basic {}", BASE64.encode(credentials.as_bytes()));
            if value.len() > MAX_TOKEN {
                return Err("Encoded OAuth client authentication exceeds 16 KiB.".into());
            }
            headers.push(HttpRequestHeader {
                name: "Authorization".into(),
                value,
            });
        }
        Authentication::Body => {
            form.push(("client_id", &request.client_id));
            form.push(("client_secret", &request.client_secret));
        }
    }
    let body = Url::parse_with_params("https://encoding.invalid/", &form)
        .map_err(|_| FAILED)?
        .query()
        .unwrap_or_default()
        .to_owned();
    let mut prepared = validate_request(HttpRequestSubmission {
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        request_id: request.request_id.clone(),
        method: "POST".into(),
        url: url.to_string(),
        headers,
        body,
        http_version: None,
        redirect_policy: Some("none".into()),
    })
    .map_err(|_| "Invalid or oversized OAuth request settings.".to_owned())?;
    for value in prepared.headers.values_mut() {
        value.set_sensitive(true);
    }
    Ok(prepared)
}
fn decode(response: HttpRequestResult) -> Result<TokenResult, String> {
    if response.status != 200 {
        // Never surface an arbitrary server description, raw token body or transport details.
        let code = serde_json::from_str::<serde_json::Value>(&response.body.content)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .filter(|code| {
                matches!(
                    code.as_str(),
                    "invalid_request"
                        | "invalid_client"
                        | "invalid_scope"
                        | "unauthorized_client"
                        | "unsupported_grant_type"
                        | "server_error"
                        | "temporarily_unavailable"
                )
            });
        return Err(format!(
            "OAuth token endpoint refused the request (HTTP {}{}).",
            response.status,
            code.map(|value| format!(", {value}")).unwrap_or_default()
        ));
    }
    if response.body.encoding != "utf-8"
        || response.body.truncated
        || response.headers_truncated
        || response
            .headers
            .iter()
            .filter(|h| h.name.eq_ignore_ascii_case("content-type"))
            .count()
            != 1
        || !response.headers.iter().any(|header| {
            header.name.eq_ignore_ascii_case("content-type")
                && header
                    .value
                    .split(';')
                    .next()
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return Err(MALFORMED.into());
    }
    let body: TokenBody = serde_json::from_str(&response.body.content).map_err(|_| MALFORMED)?;
    if !token_valid(&body.access_token)
        || !body.token_type.eq_ignore_ascii_case("Bearer")
        || body.error.is_some()
        || body.expires_in.is_some_and(|value| value > MAX_LIFETIME)
        || body.scope.as_ref().is_some_and(|value| !scope_valid(value))
    {
        return Err(MALFORMED.into());
    }
    Ok(TokenResult {
        workspace_id: response.workspace_id,
        generation: response.generation,
        request_id: response.request_id,
        access_token: body.access_token,
        token_type: "Bearer",
        expires_in: body.expires_in,
        scope: body.scope,
    })
}
async fn acquire(prepared: ValidatedRequest) -> Result<TokenResult, String> {
    decode(
        execute_with_policy(prepared, reqwest::redirect::Policy::none(), MAX_TOKEN_BODY)
            .await
            .map_err(|_| FAILED)?,
    )
}
fn capture(request: &TokenRequest) -> Result<(CurrentWorkspaceBinding, u64), String> {
    workspace_registry::with_root_activation(|| {
        let binding = workspace_registry::current_workspace_binding_at(
            &workspace::workspace_root()?,
            &app_config::workspace_registry_path()?,
        )?;
        if binding.workspace_id != request.workspace_id {
            return Err("The OAuth workspace changed.".into());
        }
        Ok((binding, workspace_registry::active_workspace_generation()))
    })
}
fn check(binding: &CurrentWorkspaceBinding, epoch: u64) -> Result<(), String> {
    workspace_registry::with_root_activation(|| {
        if workspace_registry::active_workspace_generation() != epoch
            || workspace::workspace_root()? != binding.canonical_root
            || !workspace_registry::current_workspace_binding_is_current(binding)
        {
            return Err("The OAuth workspace changed; the token was discarded.".into());
        }
        Ok(())
    })
}
#[tauri::command]
pub async fn request_oauth_client_credentials_token(
    window: WebviewWindow,
    request: TokenRequest,
) -> Result<TokenResult, String> {
    if window.label() != "main" {
        return Err("OAuth token acquisition requires the main window.".into());
    }
    let prepared = prepare(&request)?;
    let (binding, epoch) = capture(&request)?;
    check(&binding, epoch)?;
    let result = acquire(prepared).await?;
    check(&binding, epoch)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    fn request(url: &str) -> TokenRequest {
        serde_json::from_value(serde_json::json!({"workspaceId":"ws-fixture","generation":3,"requestId":"oauth-test","tokenUrl":url,"clientId":"client:é +","clientSecret":"secret:£ +&","scope":"read write","clientAuthentication":"basic","allowLoopbackHttp":true})).unwrap()
    }
    fn response(body: &str) -> HttpRequestResult {
        HttpRequestResult {
            workspace_id: "ws-fixture".into(),
            generation: 3,
            request_id: "oauth-test".into(),
            status: 200,
            reason: "OK".into(),
            elapsed_ms: 1,
            headers: vec![HttpResponseHeader {
                name: "content-type".into(),
                value: "application/json; charset=utf-8".into(),
            }],
            headers_truncated: false,
            body: HttpResponseBody {
                encoding: "utf-8",
                content: body.into(),
                truncated: false,
            },
        }
    }
    #[test]
    fn credentials_are_form_encoded_once_and_sent_using_exactly_one_authentication_method() {
        let mut request = request("https://identity.example.test/token?tenant=fixture");
        let basic = prepare(&request).unwrap();
        assert_eq!(basic.url.query(), Some("tenant=fixture"));
        assert_eq!(
            basic.headers["authorization"].to_str().unwrap(),
            format!(
                "Basic {}",
                BASE64.encode("client%3A%C3%A9+%2B:secret%3A%C2%A3+%2B%26")
            )
        );
        assert_eq!(
            basic.body,
            b"grant_type=client_credentials&scope=read+write"
        );
        request.client_authentication = Authentication::Body;
        let body = prepare(&request).unwrap();
        assert!(!body.headers.contains_key("authorization"));
        assert_eq!(String::from_utf8(body.body).unwrap(),"grant_type=client_credentials&scope=read+write&client_id=client%3A%C3%A9+%2B&client_secret=secret%3A%C2%A3+%2B%26");
        assert!(!body.url.as_str().contains("secret"));
    }
    #[test]
    fn endpoint_policy_and_scope_validation_refuse_unsupported_requests_before_network_access() {
        for url in [
            "http://identity.example.test/token",
            "http://localhost/token",
            "http://127.0.0.1.evil.test/token",
            "http://192.168.1.1/token",
            "file:///token",
            "https://user:password@example.test/token",
            "https://example.test/token#fragment",
        ] {
            assert!(prepare(&request(url)).is_err(), "{url}");
        }
        for url in ["http://127.0.0.1:1234/token", "http://[::1]:1234/token"] {
            let mut req = request(url);
            assert!(prepare(&req).is_ok());
            req.allow_loopback_http = false;
            assert!(prepare(&req).is_err());
        }
        let mut req = request("https://example.test/token");
        for scope in [
            "read  write",
            " read",
            "read ",
            "read\nwrite",
            "é",
            "read\\write",
            "read\"write",
        ] {
            req.scope = scope.into();
            assert!(prepare(&req).is_err());
        }
        req.scope = String::new();
        req.client_secret = "x".repeat(8193);
        assert!(prepare(&req).is_err());
        req.client_secret = "secret\nvalue".into();
        assert!(prepare(&req).is_err());
    }
    #[test]
    fn token_normalization_accepts_extensions_without_exposing_them_and_refuses_unsafe_or_ambiguous_tokens(
    ) {
        let result=decode(response(r#"{"access_token":"fixture.token+/==","token_type":"bEaReR","expires_in":3600,"scope":"read write","refresh_token":"ignored-secret","extension":42}"#)).unwrap();
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["accessToken"], "fixture.token+/==");
        assert_eq!(value["tokenType"], "Bearer");
        assert_eq!(value.as_object().unwrap().len(), 7);
        assert!(!value.to_string().contains("ignored-secret"));
        for body in [
            r#"{"access_token":"token","token_type":"mac"}"#,
            r#"{"access_token":"token value","token_type":"Bearer"}"#,
            r#"{"access_token":"==","token_type":"Bearer"}"#,
            r#"{"access_token":"a","access_token":"b","token_type":"Bearer"}"#,
            r#"{"access_token":"a","token_type":"Bearer","expires_in":-1}"#,
            r#"{"access_token":"a","token_type":"Bearer","expires_in":"3600"}"#,
            r#"{"access_token":"a","token_type":"Bearer","expires_in":2147483648}"#,
            r#"{"access_token":"a","token_type":"Bearer","error":"invalid_client"}"#,
        ] {
            assert!(decode(response(body)).is_err());
        }
        let no_expiry = decode(response(
            r#"{"access_token":"token","token_type":"Bearer"}"#,
        ))
        .unwrap();
        assert!(no_expiry.expires_in.is_none());
        let mut invalid = response("{}");
        invalid.body.truncated = true;
        assert!(decode(invalid).is_err());
        let mut invalid = response("{}");
        invalid.headers.clear();
        assert!(decode(invalid).is_err());
        let mut invalid = response("{}");
        invalid.headers.push(HttpResponseHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        });
        assert!(decode(invalid).is_err());
    }
    #[test]
    fn error_messages_only_include_status_and_known_error_codes() {
        let mut value =
            response(r#"{"error":"invalid_client","error_description":"private-client-secret"}"#);
        value.status = 401;
        let message = decode(value).err().unwrap();
        assert!(message.contains("invalid_client"));
        assert!(!message.contains("private-client-secret"));
        let mut value = response(r#"{"error":"private-client-secret"}"#);
        value.status = 400;
        assert!(!decode(value)
            .err()
            .unwrap()
            .contains("private-client-secret"));
    }
    fn server(
        status: &str,
        extra: &str,
        body: String,
    ) -> (String, TcpListener, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let reader = listener.try_clone().unwrap();
        let status = status.to_owned();
        let extra = extra.to_owned();
        let thread = std::thread::spawn(move || {
            let started = Instant::now();
            reader.set_nonblocking(true).unwrap();
            let mut stream = loop {
                match reader.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) =>
                    {
                        assert!(started.elapsed() < Duration::from_secs(5));
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut input = Vec::new();
            let mut buffer = [0u8; 4096];
            let read_started = Instant::now();
            loop {
                let read = match stream.read(&mut buffer) {
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                        assert!(read_started.elapsed() < Duration::from_secs(5));
                        continue;
                    }
                    result => result.unwrap(),
                };
                assert!(read > 0);
                input.extend_from_slice(&buffer[..read]);
                if let Some(position) = input.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&input[..position]);
                    let len = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if input.len() >= position + 4 + len {
                        break;
                    }
                }
                assert!(input.len() < 128 * 1024);
            }
            write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n{extra}\r\n{body}",body.len()).unwrap();
            String::from_utf8(input).unwrap()
        });
        (format!("http://{address}/token"), listener, thread)
    }
    #[test]
    fn real_http_transport_posts_only_after_acquisition_and_refuses_redirects_and_oversized_responses(
    ) {
        let (url, _listener, thread) = server(
            "200 OK",
            "",
            r#"{"access_token":"fixture-token","token_type":"Bearer","expires_in":3600}"#.into(),
        );
        let token =
            tauri::async_runtime::block_on(acquire(prepare(&request(&url)).unwrap())).unwrap();
        assert_eq!(token.access_token, "fixture-token");
        let input = thread.join().unwrap();
        assert!(input.starts_with("POST /token HTTP/1.1\r\n"));
        assert!(input.ends_with("grant_type=client_credentials&scope=read+write"));
        let (url, listener, thread) = server(
            "307 Temporary Redirect",
            "Location: /should-not-receive-credentials\r\n",
            String::new(),
        );
        assert!(tauri::async_runtime::block_on(acquire(prepare(&request(&url)).unwrap())).is_err());
        thread.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(),Err(error) if error.kind()==std::io::ErrorKind::WouldBlock)
        );
        let (url, listener, thread) =
            server("302 Found", "Location: /must-not-follow\r\n", String::new());
        let response =
            tauri::async_runtime::block_on(super::execute(prepare(&request(&url)).unwrap()))
                .unwrap();
        assert_eq!(response.status, 302);
        thread.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
        let (url, _listener, thread) = server(
            "200 OK",
            "",
            format!(
                r#"{{"access_token":"a","token_type":"Bearer","padding":"{}"}}"#,
                "x".repeat(MAX_TOKEN_BODY)
            ),
        );
        assert!(tauri::async_runtime::block_on(acquire(prepare(&request(&url)).unwrap())).is_err());
        thread.join().unwrap();
    }
}
