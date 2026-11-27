//! The files phones load: graphrt's monitoring page (built from graphrt `web/`, copied
//! from the graphrt revision Desktop pins by `scripts/sync-monitor-assets.sh`) and the
//! small pairing page of this app.
//!
//! Every file has a strong validator (a browser that has it is not sent it again) and the
//! pages a `Content-Security-Policy` that allows only their own origin.

use std::sync::LazyLock;

use axum::body::Bytes;
use axum::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};

const HTML_TYPE: &str = "text/html; charset=utf-8";
const SCRIPT_TYPE: &str = "text/javascript; charset=utf-8";

/// The monitoring page's policy, as `graphrt serve` sends it.
const MONITOR_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; \
     connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; \
     frame-ancestors 'none'";
/// The pairing page needs its script and one request to its own origin.
const PAIR_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; \
     base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// One file with its type and validator.
#[derive(Debug)]
struct Asset {
    bytes: Bytes,
    content_type: &'static str,
    etag: HeaderValue,
}

impl Asset {
    fn new(bytes: &'static [u8], content_type: &'static str) -> Self {
        let digest = Sha256::digest(bytes);
        let tag: String = digest.iter().take(12).map(|byte| format!("{byte:02x}")).collect();
        let etag = HeaderValue::from_str(&format!("\"{tag}\"")).unwrap_or_else(|_| HeaderValue::from_static("\"0\""));
        Self { bytes: Bytes::from_static(bytes), content_type, etag }
    }

    fn response(&self, request: &HeaderMap, policy: Option<&'static str>) -> Response {
        let mut response = if request.get(IF_NONE_MATCH) == Some(&self.etag) {
            StatusCode::NOT_MODIFIED.into_response()
        } else {
            self.bytes.clone().into_response()
        };
        let headers = response.headers_mut();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(self.content_type));
        headers.insert(ETAG, self.etag.clone());
        // Revalidated on every load: an updated app serves its own page at once.
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        if let Some(policy) = policy {
            headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(policy));
        }
        response
    }
}

struct Files {
    page: Asset,
    script: Asset,
    worker: Asset,
    manifest: Asset,
    icon_192: Asset,
    icon_512: Asset,
    icon_maskable: Asset,
    icon_apple: Asset,
    pair_page: Asset,
    pair_script: Asset,
}

static FILES: LazyLock<Files> = LazyLock::new(|| Files {
    page: Asset::new(include_bytes!("../../assets/monitor/index.html"), HTML_TYPE),
    script: Asset::new(include_bytes!("../../assets/monitor/monitor.js"), SCRIPT_TYPE),
    worker: Asset::new(include_bytes!("../../assets/monitor/sw.js"), SCRIPT_TYPE),
    manifest: Asset::new(include_bytes!("../../assets/monitor/manifest.webmanifest"), "application/manifest+json"),
    icon_192: Asset::new(include_bytes!("../../assets/monitor/icon-192.png"), "image/png"),
    icon_512: Asset::new(include_bytes!("../../assets/monitor/icon-512.png"), "image/png"),
    icon_maskable: Asset::new(include_bytes!("../../assets/monitor/icon-maskable.png"), "image/png"),
    icon_apple: Asset::new(include_bytes!("../../assets/monitor/apple-touch-icon.png"), "image/png"),
    pair_page: Asset::new(PAIR_PAGE.as_bytes(), HTML_TYPE),
    pair_script: Asset::new(PAIR_SCRIPT.as_bytes(), SCRIPT_TYPE),
});

/// `GET /monitor/`.
pub fn monitor_page(request: &HeaderMap) -> Response {
    FILES.page.response(request, Some(MONITOR_POLICY))
}

/// `GET /monitor/<file>`; `None` for a file the page does not have.
pub fn monitor_file(file: &str, request: &HeaderMap) -> Option<Response> {
    let files = &*FILES;
    let asset = match file {
        "monitor.js" => &files.script,
        "sw.js" => &files.worker,
        "manifest.webmanifest" => &files.manifest,
        "icon-192.png" => &files.icon_192,
        "icon-512.png" => &files.icon_512,
        "icon-maskable.png" => &files.icon_maskable,
        "apple-touch-icon.png" => &files.icon_apple,
        _ => return None,
    };
    Some(asset.response(request, None))
}

/// `GET /pair`.
pub fn pair_page(request: &HeaderMap) -> Response {
    FILES.pair_page.response(request, Some(PAIR_POLICY))
}

/// `GET /pair.js`.
pub fn pair_script(request: &HeaderMap) -> Response {
    FILES.pair_script.response(request, None)
}

/// The page a pairing QR code opens (`/pair#grp1.<code>`). The code is in the fragment, so
/// it never reaches a server log or a proxy, and the page removes it from the address bar
/// before it does anything else.
const PAIR_PAGE: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Pairing this phone</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100dvh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
main { max-width: 22rem; padding: 1.5rem; text-align: center; }
</style>
<script src="pair.js" defer></script>
</head>
<body>
<main><h1>Pairing this phone</h1><p id="status" role="status">One moment…</p></main>
</body>
</html>
"#;

const PAIR_SCRIPT: &str = r#""use strict";
(async () => {
  const status = document.getElementById("status");
  const say = (text) => { if (status) status.textContent = text; };
  const match = /^#(grp1\.[A-Za-z0-9_-]{20,})$/.exec(location.hash);
  history.replaceState(null, "", location.pathname);
  if (!match) {
    say("This link has no pairing code. Show a new code in Graphrt Desktop (Settings, Phone access) and scan it again.");
    return;
  }
  try {
    const response = await fetch("v1/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: match[1] }),
      credentials: "omit",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.token !== "string") {
      say(typeof body.error === "string" ? body.error : "This phone could not be paired. Show a new code in Graphrt Desktop.");
      return;
    }
    location.replace("monitor/#pair=" + encodeURIComponent(body.token));
  } catch {
    say("This phone cannot reach the computer. Check that both are on the same network, then scan the code again.");
  }
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_the_browser_has_is_not_sent_again() {
        let first = monitor_file("monitor.js", &HeaderMap::new()).unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let etag = first.headers().get(ETAG).unwrap().clone();
        let mut request = HeaderMap::new();
        request.insert(IF_NONE_MATCH, etag);
        assert_eq!(monitor_file("monitor.js", &request).unwrap().status(), StatusCode::NOT_MODIFIED);
    }

    #[test]
    fn pages_carry_their_policy_and_unknown_files_are_missing() {
        let page = monitor_page(&HeaderMap::new());
        assert!(page
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert!(pair_page(&HeaderMap::new()).headers().get(CONTENT_SECURITY_POLICY).is_some());
        assert!(monitor_file("../secrets", &HeaderMap::new()).is_none());
    }
}
