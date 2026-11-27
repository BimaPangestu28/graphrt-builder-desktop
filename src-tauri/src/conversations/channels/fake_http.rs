//! A small HTTP/1.1 server on `127.0.0.1` for the channel tests: the fake Telegram Bot API,
//! Meta's Graph API and the online chatbot's API. Every request is recorded; a handler
//! answers each from the test's own state.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value as Json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// One request the server received.
#[derive(Debug, Clone)]
pub struct FakeRequest {
    pub method: String,
    /// The path with its query, e.g. `/bot123:abc/getUpdates`.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl FakeRequest {
    pub fn json(&self) -> Json {
        serde_json::from_slice(&self.body).unwrap_or(Json::Null)
    }

    pub fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

/// The answer to a request.
#[derive(Debug, Clone)]
pub struct FakeResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    /// Waits this long before answering (a long poll with nothing to say).
    pub delay: Duration,
}

impl FakeResponse {
    pub fn json(status: u16, body: &Json) -> Self {
        Self {
            status,
            content_type: "application/json".into(),
            body: body.to_string().into_bytes(),
            delay: Duration::ZERO,
        }
    }

    pub fn bytes(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self { status, content_type: content_type.into(), body, delay: Duration::ZERO }
    }

    pub fn after(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

type Handler = dyn Fn(&FakeRequest) -> FakeResponse + Send + Sync;

/// A running fake server; stops when dropped.
pub struct FakeServer {
    pub base_url: String,
    requests: Arc<Mutex<Vec<FakeRequest>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeServer {
    pub async fn start(handler: impl Fn(&FakeRequest) -> FakeResponse + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind a local port");
        let address = listener.local_addr().expect("local address");
        let requests: Arc<Mutex<Vec<FakeRequest>>> = Arc::default();
        let handler: Arc<Handler> = Arc::new(handler);
        let recorded = requests.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { return };
                let (handler, recorded) = (handler.clone(), recorded.clone());
                tokio::spawn(async move {
                    let Some(request) = read_request(&mut stream).await else { return };
                    recorded.lock().expect("requests").push(request.clone());
                    let response = handler(&request);
                    if !response.delay.is_zero() {
                        tokio::time::sleep(response.delay).await;
                    }
                    let head = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        response.status,
                        response.content_type,
                        response.body.len()
                    );
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(&response.body).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        Self { base_url: format!("http://{address}"), requests, task }
    }

    pub fn requests(&self) -> Vec<FakeRequest> {
        self.requests.lock().expect("requests").clone()
    }

    /// The requests whose path ends with `suffix` (a Bot API method, a route).
    pub fn requests_to(&self, suffix: &str) -> Vec<FakeRequest> {
        self.requests()
            .into_iter()
            .filter(|request| request.path.split('?').next().unwrap_or_default().ends_with(suffix))
            .collect()
    }
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> Option<FakeRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    let head_end = loop {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break position;
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split(' ');
    let (method, path) = (request_line.next()?.to_owned(), request_line.next()?.to_owned());
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':').map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned())))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse().ok())
        .unwrap_or(0);
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Some(FakeRequest { method, path, headers, body })
}

/// Waits until `condition` holds, checking every 20 ms, for at most `seconds`.
pub async fn eventually(seconds: u64, mut condition: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while tokio::time::Instant::now() < deadline {
        if condition() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    condition()
}
