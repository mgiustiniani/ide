//! Explicit, bounded HTTP requests for the workspace API client.

pub mod library;
pub mod oauth;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_WORKSPACE_ID_BYTES: usize = 256;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_HEADERS: usize = 64;
const MAX_REQUEST_HEADER_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_HEADERS: usize = 128;
const MAX_RESPONSE_HEADER_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSubmission {
    workspace_id: String,
    generation: u64,
    request_id: String,
    method: String,
    url: String,
    headers: Vec<HttpRequestHeader>,
    body: String,
    http_version: Option<String>,
    redirect_policy: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestHeader {
    name: String,
    value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    status: u16,
    reason: String,
    elapsed_ms: u64,
    headers: Vec<HttpResponseHeader>,
    headers_truncated: bool,
    body: HttpResponseBody,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponseHeader {
    name: String,
    value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponseBody {
    encoding: &'static str,
    content: String,
    truncated: bool,
}

struct ValidatedRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    method: Method,
    url: Url,
    headers: HeaderMap,
    body: Vec<u8>,
    http_version: Option<reqwest::Version>,
    no_redirects: bool,
}

fn validate_request(request: HttpRequestSubmission) -> Result<ValidatedRequest, String> {
    if request.workspace_id.trim().is_empty()
        || request.workspace_id.len() > MAX_WORKSPACE_ID_BYTES
        || request.workspace_id.contains('\0')
    {
        return Err("The active workspace identity is invalid.".into());
    }
    if request.request_id.trim().is_empty()
        || request.request_id.len() > MAX_REQUEST_ID_BYTES
        || request.request_id.contains('\0')
    {
        return Err("The HTTP request identity is invalid.".into());
    }
    if request.url.len() > MAX_URL_BYTES {
        return Err("The request URL exceeds the 8 KiB limit.".into());
    }

    let url = Url::parse(&request.url).map_err(|_| "Enter a valid absolute HTTP or HTTPS URL.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("Only absolute HTTP and HTTPS URLs are supported.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Credentials in the request URL are not supported; use an explicit header.".into(),
        );
    }

    let http_version = match request.http_version.as_deref() {
        None => None,
        Some("HTTP/1.1") => Some(reqwest::Version::HTTP_11),
        Some(_) => return Err("Only explicit HTTP/1.1 is supported.".into()),
    };
    let no_redirects = match request.redirect_policy.as_deref() {
        None => false,
        Some("none") => true,
        Some(_) => return Err("Unsupported HTTP redirect policy.".into()),
    };
    let method = match request.method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "PATCH" => Method::PATCH,
        "DELETE" => Method::DELETE,
        "HEAD" => Method::HEAD,
        "OPTIONS" => Method::OPTIONS,
        _ => return Err("Choose a supported HTTP method.".into()),
    };
    if !request.body.is_empty() && matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return Err("A request body is supported only for POST, PUT, PATCH and DELETE.".into());
    }

    let body = request.body.into_bytes();
    if body.len() > MAX_REQUEST_BODY_BYTES {
        return Err("The request body exceeds the 1 MiB limit.".into());
    }
    if request.headers.len() > MAX_REQUEST_HEADERS {
        return Err("A request can contain at most 64 headers.".into());
    }

    let mut headers = HeaderMap::new();
    let mut header_bytes = 0usize;
    for header in request.headers {
        if header.name.is_empty() {
            return Err("HTTP header names cannot be empty.".into());
        }
        header_bytes = header_bytes.saturating_add(header.name.len() + header.value.len());
        if header_bytes > MAX_REQUEST_HEADER_BYTES {
            return Err("Request headers exceed the 64 KiB limit.".into());
        }
        let name = HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|_| "A request header name is invalid.")?;
        let value = HeaderValue::from_bytes(header.value.as_bytes())
            .map_err(|_| "A request header value is invalid.")?;
        headers.append(name, value);
    }

    Ok(ValidatedRequest {
        workspace_id: request.workspace_id,
        generation: request.generation,
        request_id: request.request_id,
        method,
        url,
        headers,
        body,
        http_version,
        no_redirects,
    })
}

fn bounded_response_headers(response: &reqwest::Response) -> (Vec<HttpResponseHeader>, bool) {
    let mut headers = Vec::new();
    let mut total_bytes = 0usize;
    let mut truncated = false;
    for (name, value) in response.headers() {
        let display_value = value.to_str().map(ToOwned::to_owned).unwrap_or_else(|_| {
            format!("[non-text header value: {} bytes]", value.as_bytes().len())
        });
        let size = name.as_str().len().saturating_add(display_value.len());
        if headers.len() >= MAX_RESPONSE_HEADERS
            || total_bytes.saturating_add(size) > MAX_RESPONSE_HEADER_BYTES
        {
            truncated = true;
            break;
        }
        total_bytes += size;
        headers.push(HttpResponseHeader {
            name: name.to_string(),
            value: display_value,
        });
    }
    (headers, truncated)
}

async fn execute(request: ValidatedRequest) -> Result<HttpRequestResult, String> {
    let policy = if request.no_redirects { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(5) };
    execute_with_policy(request, policy, MAX_RESPONSE_BODY_BYTES).await
}

async fn execute_with_policy(
    request: ValidatedRequest,
    redirect: reqwest::redirect::Policy,
    response_limit: usize,
) -> Result<HttpRequestResult, String> {
    let mut client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(redirect);
    if request.http_version == Some(reqwest::Version::HTTP_11) { client = client.http1_only(); }
    let client = client.build()
        .map_err(|error| format!("Could not prepare the HTTP client: {}", error.without_url()))?;

    let mut builder = client
        .request(request.method.clone(), request.url.clone())
        .headers(request.headers.clone());
    if let Some(version) = request.http_version { builder = builder.version(version); }
    if !request.body.is_empty() {
        builder = builder.body(request.body);
    }
    let started = Instant::now();
    let mut response = builder
        .send()
        .await
        .map_err(|error| format!("HTTP request failed: {}", error.without_url()))?;
    let status: StatusCode = response.status();
    let reason = status.canonical_reason().unwrap_or("").to_owned();
    let (headers, headers_truncated) = bounded_response_headers(&response);
    let mut bytes = Vec::with_capacity(16 * 1024);
    let mut body_truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read the HTTP response: {}", error.without_url()))?
    {
        let remaining = response_limit.saturating_sub(bytes.len());
        if chunk.len() > remaining {
            bytes.extend_from_slice(&chunk[..remaining]);
            body_truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
        if bytes.len() == response_limit {
            if response
                .chunk()
                .await
                .map_err(|error| {
                    format!("Could not read the HTTP response: {}", error.without_url())
                })?
                .is_some()
            {
                body_truncated = true;
            }
            break;
        }
    }
    let body = match String::from_utf8(bytes) {
        Ok(content) => HttpResponseBody {
            encoding: "utf-8",
            content,
            truncated: body_truncated,
        },
        Err(error) => HttpResponseBody {
            encoding: "base64",
            content: BASE64.encode(error.into_bytes()),
            truncated: body_truncated,
        },
    };

    Ok(HttpRequestResult {
        workspace_id: request.workspace_id,
        generation: request.generation,
        request_id: request.request_id,
        status: status.as_u16(),
        reason,
        elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        headers,
        headers_truncated,
        body,
    })
}

#[tauri::command]
pub async fn send_http_request(
    request: HttpRequestSubmission,
) -> Result<HttpRequestResult, String> {
    execute(validate_request(request)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn request(method: &str, url: &str) -> HttpRequestSubmission {
        HttpRequestSubmission {
            workspace_id: "workspace-test".into(),
            generation: 2,
            request_id: "request-test".into(),
            method: method.into(),
            url: url.into(),
            headers: Vec::new(),
            body: String::new(),
            http_version: None,
            redirect_policy: None,
        }
    }

    #[test]
    fn validates_http_methods_urls_headers_and_body_limits() {
        let mut valid = request("POST", "https://example.test/api");
        valid.headers.push(HttpRequestHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        });
        valid.body = "{}".into();
        assert!(validate_request(valid).is_ok());

        for url in [
            "file:///etc/passwd",
            "ftp://example.test/file",
            "http://u:p@example.test",
        ] {
            assert!(validate_request(request("GET", url)).is_err());
        }
        assert!(validate_request(request("TRACE", "https://example.test/")).is_err());

        let mut invalid_header = request("GET", "https://example.test/");
        invalid_header.headers.push(HttpRequestHeader {
            name: "X-Test\nInjected".into(),
            value: "value".into(),
        });
        assert!(validate_request(invalid_header).is_err());

        let mut invalid_body = request("GET", "https://example.test/");
        invalid_body.body = "not allowed".into();
        assert!(validate_request(invalid_body).is_err());

        let mut oversized_body = request("POST", "https://example.test/");
        oversized_body.body = "x".repeat(MAX_REQUEST_BODY_BYTES + 1);
        assert!(validate_request(oversized_body).is_err());

        let mut too_many_headers = request("GET", "https://example.test/");
        too_many_headers.headers = (0..=MAX_REQUEST_HEADERS)
            .map(|index| HttpRequestHeader {
                name: format!("X-Test-{index}"),
                value: "value".into(),
            })
            .collect();
        assert!(validate_request(too_many_headers).is_err());
    }

    #[test]
    fn sends_a_user_selected_request_and_returns_the_response() {
        for version in [None, Some("HTTP/1.1")] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind local HTTP fixture");
            let address = listener.local_addr().expect("fixture address");
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept local HTTP request");
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request_bytes = Vec::new();
                let mut chunk = [0u8; 1024];
                while !request_bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                    let size = match stream.read(&mut chunk) {
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        result => result.expect("read HTTP request"),
                    };
                    assert!(size > 0); request_bytes.extend_from_slice(&chunk[..size]);
                    assert!(request_bytes.len() <= 4096);
                }
                assert!(String::from_utf8(request_bytes).unwrap().starts_with("GET /api/hello HTTP/1.1\r\n"));
                let body = "local response";
                write!(
                    stream,
                    "HTTP/1.1 201 Created\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("write HTTP response");
            });

            let mut selected = request("GET", &format!("http://{address}/api/hello"));
            selected.http_version = version.map(str::to_string);
            let result = tauri::async_runtime::block_on(send_http_request(selected))
            .expect("send local HTTP request");
            server.join().expect("join fixture server");

            assert_eq!(result.status, 201);
            assert_eq!(result.workspace_id, "workspace-test");
            assert_eq!(result.generation, 2);
            assert_eq!(result.request_id, "request-test");
            assert_eq!(result.body.encoding, "utf-8");
            assert_eq!(result.body.content, "local response");
            assert!(!result.body.truncated);
            assert!(result
                .headers
                .iter()
                .any(|header| header.name == "content-type"));
        }
    }

    #[test]
    fn authorization_is_sent_to_the_selected_service_but_not_a_redirected_origin() {
        fn read_headers(stream: &mut std::net::TcpStream) -> String {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut bytes = Vec::new(); let mut chunk = [0u8; 1024];
            while !bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                assert!(!remaining.is_zero(), "HTTP fixture header read exceeded its deadline");
                stream.set_read_timeout(Some(remaining)).unwrap();
                let count = match stream.read(&mut chunk) {
                    Ok(count) => count,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => panic!("HTTP fixture header read failed: {error}"),
                };
                assert!(count > 0);
                bytes.extend_from_slice(&chunk[..count]); assert!(bytes.len() < 8192);
            }
            String::from_utf8(bytes).unwrap().to_lowercase()
        }
        for credentials in ["Basic dGVzdDoxMjPCow==", "Bearer local-fixture-token"] {
            let first = TcpListener::bind("127.0.0.1:0").unwrap();
            let second = TcpListener::bind("127.0.0.1:0").unwrap();
            let first_address = first.local_addr().unwrap();
            let second_address = second.local_addr().unwrap();
            let expected = credentials.to_lowercase();
            let origin = thread::spawn(move || {
                let (mut stream, _) = first.accept().unwrap();
                assert!(read_headers(&mut stream).contains(&format!("authorization: {expected}\r\n")));
                write!(stream, "HTTP/1.1 302 Found\r\nLocation: http://{second_address}/redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            });
            let redirected = thread::spawn(move || {
                let (mut stream, _) = second.accept().unwrap();
                assert!(!read_headers(&mut stream).contains("authorization:"));
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
            });
            let mut selected = request("GET", &format!("http://{first_address}/selected"));
            selected.headers.push(HttpRequestHeader { name: "Authorization".into(), value: credentials.into() });
            let response = tauri::async_runtime::block_on(send_http_request(selected)).unwrap();
            assert_eq!(response.status, 200); assert_eq!(response.body.content, "ok");
            origin.join().unwrap(); redirected.join().unwrap();
        }
    }

    #[test]
    fn explicit_http_version_is_validated_before_network_access() {
        let mut selected = request("GET", "http://localhost/");
        selected.http_version = Some("HTTP/1.1".into());
        assert_eq!(validate_request(selected).unwrap().http_version, Some(reqwest::Version::HTTP_11));
        let mut unsupported = request("GET", "http://localhost/");
        unsupported.http_version = Some("HTTP/2".into());
        assert!(validate_request(unsupported).is_err());
    }

    #[test]
    fn truncates_a_response_body_at_the_display_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local HTTP fixture");
        let address = listener.local_addr().expect("fixture address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept local HTTP request");
            let mut request_bytes = [0u8; 4096];
            let _ = stream.read(&mut request_bytes).expect("read HTTP request");
            let body = vec![b'x'; MAX_RESPONSE_BODY_BYTES + 64];
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .expect("write response headers");
            stream
                .write_all(&body)
                .expect("write bounded response body");
        });

        let result = tauri::async_runtime::block_on(send_http_request(request(
            "GET",
            &format!("http://{address}/large"),
        )))
        .expect("send local HTTP request");
        server.join().expect("join fixture server");

        assert_eq!(result.body.encoding, "utf-8");
        assert_eq!(result.body.content.len(), MAX_RESPONSE_BODY_BYTES);
        assert!(result.body.truncated);
    }
}
