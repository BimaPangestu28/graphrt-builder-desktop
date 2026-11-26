//! The loopback redirect (RFC 8252 §7.3): a listener on `127.0.0.1` that
//! accepts the browser's `GET /callback?code=…&state=…`, answers with a short
//! page and hands the code over. Requests to other paths get a 404, and a
//! callback whose `state` does not match is refused (and ignored).

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::OAuthError;

const CALLBACK_PATH: &str = "/callback";
/// Longest request head read from the browser.
const MAX_REQUEST_BYTES: usize = 16 * 1024;
/// How long a connection may take to send its request head.
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>graphrt</title>\
<body style=\"font-family:system-ui;margin:3rem\"><h1>Signed in</h1><p>You can close this tab and go back to graphrt.</p>";

/// A listener waiting for one sign-in callback.
pub struct CallbackListener {
    listener: TcpListener,
    port: u16,
}

impl CallbackListener {
    /// Listens on `127.0.0.1:<preferred>` when that port is free, else on any free port.
    ///
    /// # Errors
    /// `Authorization` when no port can be opened.
    pub async fn bind(preferred: Option<u16>) -> Result<Self, OAuthError> {
        let listener = match preferred {
            Some(port) => match TcpListener::bind(("127.0.0.1", port)).await {
                Ok(listener) => listener,
                Err(_) => bind_any().await?,
            },
            None => bind_any().await?,
        };
        let port = listener
            .local_addr()
            .map_err(|error| OAuthError::Authorization(format!("could not open the sign-in callback: {error}")))?
            .port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// The authorization code of the first callback whose `state` matches.
    ///
    /// # Errors
    /// `Authorization` when the sign-in server reports an error (e.g. the user denied access).
    /// An `iss` parameter (RFC 9207) must name `expected_issuer`.
    pub async fn wait_for_code(&self, expected_state: &str, expected_issuer: &str) -> Result<String, OAuthError> {
        loop {
            let Ok((stream, _)) = self.listener.accept().await else {
                // e.g. too many open files: wait instead of spinning.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                continue;
            };
            match handle(stream, expected_state, expected_issuer).await {
                Callback::Code(code) => return Ok(code),
                Callback::Denied(reason) => return Err(OAuthError::Authorization(reason)),
                Callback::Ignored => continue,
            }
        }
    }
}

async fn bind_any() -> Result<TcpListener, OAuthError> {
    TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| OAuthError::Authorization(format!("could not open the sign-in callback: {error}")))
}

/// The port of a stored `http://127.0.0.1:<port>/callback`.
pub fn port_of(redirect_uri: &str) -> Option<u16> {
    url::Url::parse(redirect_uri).ok()?.port()
}

enum Callback {
    Code(String),
    Denied(String),
    Ignored,
}

async fn handle(mut stream: TcpStream, expected_state: &str, expected_issuer: &str) -> Callback {
    let target = tokio::time::timeout(READ_TIMEOUT, read_request_target(&mut stream)).await.ok().flatten();
    let Some(target) = target else {
        respond(&mut stream, "400 Bad Request", "Bad request").await;
        return Callback::Ignored;
    };
    let outcome = parse_callback(&target, expected_state, expected_issuer);
    match &outcome {
        Callback::Code(_) => respond(&mut stream, "200 OK", DONE_PAGE).await,
        Callback::Denied(reason) => {
            let page = format!("Sign-in was not completed: {}. Go back to graphrt and try again.", escape_html(reason));
            respond(&mut stream, "200 OK", &page).await;
        }
        Callback::Ignored => respond(&mut stream, "404 Not Found", "Not found").await,
    }
    outcome
}

/// The decision for a request target such as `/callback?code=…&state=…`.
fn parse_callback(target: &str, expected_state: &str, expected_issuer: &str) -> Callback {
    let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Ignored };
    if url.path() != CALLBACK_PATH {
        return Callback::Ignored;
    }
    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut description = None;
    let mut issuer = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "iss" => issuer = Some(value.into_owned()),
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => description = Some(value.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Callback::Ignored;
    }
    // Mix-up protection (RFC 9207): an answer that says it is from another server is refused.
    if issuer.as_deref().is_some_and(|issuer| issuer.trim_end_matches('/') != expected_issuer.trim_end_matches('/')) {
        return Callback::Denied("the sign-in answer came from another server".into());
    }
    if let Some(error) = error {
        let reason = match description {
            Some(description) => format!("{error}: {description}"),
            None if error == "access_denied" => "access was denied".to_owned(),
            None => error,
        };
        return Callback::Denied(reason);
    }
    match code {
        Some(code) if !code.is_empty() => Callback::Code(code),
        _ => Callback::Denied("the sign-in server sent no code".into()),
    }
}

/// The target of `GET <target> HTTP/1.1`.
async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut head = Vec::new();
    let mut buffer = [0u8; 2048];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        head.extend_from_slice(buffer.get(..read)?);
        if head.len() > MAX_REQUEST_BYTES {
            return None;
        }
    }
    let text = String::from_utf8_lossy(&head);
    let mut parts = text.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_owned)
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\n\
         cache-control: no-store\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ignored = stream.write_all(response.as_bytes()).await;
    let _ignored = stream.shutdown().await;
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod parse_tests {
    use super::*;

    const ISSUER: &str = "https://as.example";

    #[test]
    fn reads_code_and_checks_state() {
        assert!(
            matches!(parse_callback("/callback?code=abc&state=s1", "s1", ISSUER), Callback::Code(code) if code == "abc")
        );
        assert!(matches!(parse_callback("/callback?code=abc&state=other", "s1", ISSUER), Callback::Ignored));
        assert!(matches!(parse_callback("/favicon.ico", "s1", ISSUER), Callback::Ignored));
        assert!(matches!(
            parse_callback("/callback?error=access_denied&state=s1", "s1", ISSUER),
            Callback::Denied(reason) if reason == "access was denied"
        ));
        assert!(matches!(parse_callback("/callback?state=s1", "s1", ISSUER), Callback::Denied(_)));
    }

    #[test]
    fn an_answer_from_another_issuer_is_refused() {
        let own = "/callback?code=abc&state=s1&iss=https%3A%2F%2Fas.example%2F";
        assert!(matches!(parse_callback(own, "s1", ISSUER), Callback::Code(code) if code == "abc"));
        let other = "/callback?code=abc&state=s1&iss=https%3A%2F%2Fevil.example";
        assert!(
            matches!(parse_callback(other, "s1", ISSUER), Callback::Denied(reason) if reason.contains("another server"))
        );
    }

    #[tokio::test]
    async fn the_listener_ignores_strays_and_takes_the_matching_callback() {
        let listener = CallbackListener::bind(None).await.expect("bound");
        let redirect = listener.redirect_uri();
        tokio::spawn(async move {
            for target in
                ["/favicon.ico".to_owned(), "?code=forged&state=wrong".to_owned(), "?code=real&state=s1".to_owned()]
            {
                let url = if target.starts_with('/') {
                    redirect.replace("/callback", &target)
                } else {
                    format!("{redirect}{target}")
                };
                let _ignored = reqwest::get(url).await;
            }
        });
        let code = tokio::time::timeout(std::time::Duration::from_secs(5), listener.wait_for_code("s1", ISSUER)).await;
        assert_eq!(code.expect("in time").expect("a code"), "real");
    }

    #[test]
    fn port_of_a_redirect_uri() {
        assert_eq!(port_of("http://127.0.0.1:43123/callback"), Some(43123));
        assert_eq!(port_of("not a url"), None);
    }
}
