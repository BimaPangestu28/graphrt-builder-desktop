//! Connector sources end to end against mock services: adding, the first
//! sync, incremental re-syncs (changed, unchanged, deleted), credentials in the
//! keychain only, the schedule, and the lock shared with `graphrt serve`.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::connectors::{
    ConnectorAuth, ConnectorAuthInput, ConnectorKind, NewConnectorSource, PRIVATE_ENDPOINTS_FOR_TESTS,
};
use super::events::{KnowledgeEvent, KnowledgeEventSink};
use super::models::SourceStatus;
use super::*;
use crate::credentials::CredentialStore;

#[derive(Debug, Default)]
struct Sink;

impl KnowledgeEventSink for Sink {
    fn send(&self, _event: KnowledgeEvent) {}
}

/// `path -> (content type, body)`.
type Routes = Arc<Mutex<HashMap<String, (String, String)>>>;
/// `(path, Authorization header)` of every request.
type RequestLog = Arc<Mutex<Vec<(String, Option<String>)>>>;

/// Canned answers by path, changeable during a test, plus a request log.
#[derive(Clone, Default)]
struct Mock {
    routes: Routes,
    log: RequestLog,
}

impl Mock {
    async fn start(&self) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mock = self.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let mock = mock.clone();
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 16 * 1024];
                    let read = socket.read(&mut buffer).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buffer[..read]).into_owned();
                    let target = head.split(' ').nth(1).unwrap_or_default().to_owned();
                    let path = target.split('?').next().unwrap_or_default().to_owned();
                    let authorization = head
                        .lines()
                        .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
                        .map(|line| line.split_once(':').map(|(_, v)| v.trim().to_owned()).unwrap_or_default());
                    mock.log.lock().unwrap().push((path.clone(), authorization));
                    let reply = mock.routes.lock().unwrap().get(&path).cloned();
                    let (status, content_type, body) = match reply {
                        Some((content_type, body)) => ("200 OK", content_type, body),
                        None => ("404 Not Found", "text/plain".to_owned(), String::new()),
                    };
                    let response = format!(
                        "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        base
    }

    fn route(&self, path: &str, content_type: &str, body: &str) {
        self.routes.lock().unwrap().insert(path.to_owned(), (content_type.to_owned(), body.to_owned()));
    }

    fn requests_to(&self, path: &str) -> usize {
        self.log.lock().unwrap().iter().filter(|(p, _)| p == path).count()
    }
}

fn service() -> (Arc<KnowledgeService>, Arc<Database>, Arc<CredentialStore>, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    let service = Arc::new(KnowledgeService::new(
        db.clone(),
        credentials.clone(),
        directory.path().join(KNOWLEDGE_DIR_NAME),
        Arc::new(Sink),
    ));
    (service, db, credentials, directory)
}

fn sitemap(base: &str, b_lastmod: &str) -> String {
    format!(
        "<urlset><url><loc>{base}/menu</loc><lastmod>2026-11-01</lastmod></url>\
         <url><loc>{base}/hours</loc><lastmod>{b_lastmod}</lastmod></url></urlset>"
    )
}

#[tokio::test]
async fn a_website_syncs_incrementally_and_is_searchable() {
    let mock = Mock::default();
    let base = mock.start().await;
    mock.route("/sitemap.xml", "application/xml", &sitemap(&base, "2026-11-01"));
    mock.route("/menu", "text/html", "<title>Menu</title><h1>Menu</h1><p>Our oat latte costs 4 euro.</p>");
    mock.route("/hours", "text/html", "<title>Hours</title><h1>Hours</h1><p>We open at seven on weekdays.</p>");
    let (service, _db, _credentials, _dir) = service();
    let knowledge_base = service.create_knowledge_base("Coffee shop", "").unwrap();
    let source = service
        .add_connector_source(
            &knowledge_base.id,
            NewConnectorSource {
                kind: ConnectorKind::Website,
                name: String::new(),
                options: serde_json::json!({ "urls": [format!("{base}/sitemap.xml")], "mode": "sitemap", "allow_private": true }),
                auth: ConnectorAuthInput::None,
                schedule: graphrt_connect::SyncSchedule::every_hours(6),
            },
        )
        .unwrap();
    assert_eq!(source.kind, SourceKind::Url);
    let connector = source.connector.as_ref().expect("a connector source");
    assert_eq!(connector.kind, ConnectorKind::Website);
    assert!(connector.next_sync_at.is_some(), "never synced: due now");
    assert!(source.name.starts_with("127.0.0.1"), "named after the address: {}", source.name);

    let report = service.sync_sources(&knowledge_base.id, std::slice::from_ref(&source.id)).await.unwrap();
    assert_eq!(report.documents_indexed, 2, "{report:?}");
    let synced = service.source(&source.id).unwrap();
    assert_eq!(synced.status, SourceStatus::Indexed);
    assert_eq!(synced.document_count, 2);
    let next = synced.connector.as_ref().and_then(|c| c.next_sync_at.clone()).unwrap();
    assert!(next > synced.last_synced_at.clone().unwrap(), "next sync six hours after the last");
    let passages = service.search("when do you open", Some(vec![knowledge_base.id.clone()]), 3).await.unwrap();
    assert!(passages.first().is_some_and(|p| p.text.contains("seven")), "{passages:?}");

    // Same lastmod: nothing downloaded. A newer lastmod: that page only.
    mock.route("/sitemap.xml", "application/xml", &sitemap(&base, "2026-11-20"));
    mock.route("/hours", "text/html", "<title>Hours</title><h1>Hours</h1><p>We open at eight on weekdays.</p>");
    let menu_requests = mock.requests_to("/menu");
    let report = service.sync_sources(&knowledge_base.id, std::slice::from_ref(&source.id)).await.unwrap();
    assert_eq!((report.documents_indexed, report.documents_unchanged), (1, 1), "{report:?}");
    assert_eq!(mock.requests_to("/menu"), menu_requests, "unchanged page not downloaded");
    let passages = service.search("when do you open", Some(vec![knowledge_base.id.clone()]), 3).await.unwrap();
    assert!(passages.first().is_some_and(|p| p.text.contains("eight")));

    // A page removed from the sitemap is removed from the knowledge base.
    mock.route(
        "/sitemap.xml",
        "application/xml",
        &format!("<urlset><url><loc>{base}/menu</loc><lastmod>2026-11-01</lastmod></url></urlset>"),
    );
    let report = service.sync_sources(&knowledge_base.id, std::slice::from_ref(&source.id)).await.unwrap();
    assert_eq!(report.documents_removed, 1);
    assert_eq!(service.source(&source.id).unwrap().document_count, 1);
}

#[tokio::test]
async fn notion_tokens_stay_in_the_keychain() {
    PRIVATE_ENDPOINTS_FOR_TESTS.store(true, Ordering::Relaxed);
    let mock = Mock::default();
    let base = mock.start().await;
    let page = "1429989fe8ac4effbc8f57f56486db54";
    mock.route(
        &format!("/v1/pages/{page}"),
        "application/json",
        &serde_json::json!({ "object": "page", "id": page, "last_edited_time": "2026-11-01T00:00:00Z",
            "properties": { "Name": { "type": "title", "title": [{ "plain_text": "Refunds" }] } } })
        .to_string(),
    );
    mock.route(
        &format!("/v1/blocks/{page}/children"),
        "application/json",
        &serde_json::json!({ "results": [{ "type": "paragraph", "paragraph": { "rich_text": [{ "plain_text": "Refunds take five working days." }] } }], "has_more": false })
            .to_string(),
    );
    let (service, db, credentials, _dir) = service();
    let knowledge_base = service.create_knowledge_base("Support", "").unwrap();
    let source = service
        .add_connector_source(
            &knowledge_base.id,
            NewConnectorSource {
                kind: ConnectorKind::Notion,
                name: "Support wiki".into(),
                options: serde_json::json!({ "page_ids": [page], "base_url": format!("{base}/v1") }),
                auth: ConnectorAuthInput::Token { token: "ntn_secret_value".into() },
                schedule: graphrt_connect::SyncSchedule::Manual,
            },
        )
        .unwrap();
    assert_eq!(source.connector.as_ref().unwrap().auth, ConnectorAuth::Token);
    assert_eq!(source.connector.as_ref().unwrap().next_sync_at, None, "manual");
    let stored: String = db
        .lock()
        .unwrap()
        .query_row("SELECT options_json || auth_json FROM knowledge_connectors", [], |row| row.get(0))
        .unwrap();
    assert!(!stored.contains("ntn_secret_value"), "no secret in the database: {stored}");
    assert_eq!(credentials.read_knowledge_secret(&source.id, "token").unwrap().as_deref(), Some("ntn_secret_value"));

    service.sync_sources(&knowledge_base.id, std::slice::from_ref(&source.id)).await.unwrap();
    let passages = service.search("refund", Some(vec![knowledge_base.id.clone()]), 3).await.unwrap();
    assert!(passages.first().is_some_and(|p| p.text.contains("five working days")));
    assert!(mock.log.lock().unwrap().iter().all(|(_, auth)| auth.as_deref() == Some("Bearer ntn_secret_value")));

    service.remove_source(&source.id).await.unwrap();
    assert_eq!(credentials.read_knowledge_secret(&source.id, "token").unwrap(), None, "removed with the source");
}

#[tokio::test]
async fn bad_settings_are_refused_before_anything_is_saved() {
    let (service, _db, _credentials, _dir) = service();
    let knowledge_base = service.create_knowledge_base("Docs", "").unwrap();
    let result = service.add_connector_source(
        &knowledge_base.id,
        NewConnectorSource {
            kind: ConnectorKind::Website,
            name: String::new(),
            options: serde_json::json!({ "urls": ["not a link"] }),
            auth: ConnectorAuthInput::None,
            schedule: graphrt_connect::SyncSchedule::Manual,
        },
    );
    assert!(matches!(result, Err(AppError::InvalidInput(_))), "{result:?}");
    assert!(service.get_knowledge_base(&knowledge_base.id).unwrap().sources.is_empty());
    let expired = service.add_connector_source(
        &knowledge_base.id,
        NewConnectorSource {
            kind: ConnectorKind::GoogleDrive,
            name: String::new(),
            options: serde_json::json!({ "folder_id": "root" }),
            auth: ConnectorAuthInput::Oauth { sign_in_id: "signin_unknown".into() },
            schedule: graphrt_connect::SyncSchedule::Manual,
        },
    );
    assert!(matches!(expired, Err(AppError::InvalidInput(_))));
}

#[tokio::test]
async fn the_schedule_finds_due_sources_and_the_lock_is_shared_with_serve() {
    let mock = Mock::default();
    let base = mock.start().await;
    mock.route("/", "text/html", "<title>Home</title><p>Free delivery above 20 euro.</p>");
    let (service, _db, _credentials, _dir) = service();
    let knowledge_base = service.create_knowledge_base("Shop", "").unwrap();
    let new = |schedule| NewConnectorSource {
        kind: ConnectorKind::Website,
        name: String::new(),
        options: serde_json::json!({ "urls": [format!("{base}/")], "allow_private": true }),
        auth: ConnectorAuthInput::None,
        schedule,
    };
    let hourly =
        service.add_connector_source(&knowledge_base.id, new(graphrt_connect::SyncSchedule::every_hours(1))).unwrap();
    let manual = service.add_connector_source(&knowledge_base.id, new(graphrt_connect::SyncSchedule::Manual));
    // The same address twice is allowed for connectors (each has its own row).
    let manual = manual.unwrap();
    let now = chrono::Utc::now().timestamp();
    let due = connector_schedule::due_sources(&service, now).unwrap();
    assert_eq!(due.get(&knowledge_base.id), Some(&vec![hourly.id.clone()]), "manual sources never come due");

    // graphrt serve holds the lock of this source in the shared state file.
    let stored = records::get_knowledge_base(&service.db, &knowledge_base.id).unwrap();
    let state = graphrt_connect::SqliteSyncState::open(&graphrt_connect::SqliteSyncState::path_beside(
        std::path::Path::new(&stored.store_path),
    ))
    .unwrap();
    assert!(graphrt_connect::SyncState::try_lock(&state, &hourly.id, "graphrt-serve:host:1", now, now + 600).unwrap());
    let report = service.sync_sources(&knowledge_base.id, std::slice::from_ref(&hourly.id)).await.unwrap();
    assert_eq!(report.documents_indexed, 0, "skipped while serve syncs it");
    assert_eq!(service.source(&hourly.id).unwrap().connector.unwrap().last_error_kind.as_deref(), Some("busy"));
    graphrt_connect::SyncState::unlock(&state, &hourly.id, "graphrt-serve:host:1").unwrap();

    service.sync_sources(&knowledge_base.id, std::slice::from_ref(&hourly.id)).await.unwrap();
    let due = connector_schedule::due_sources(&service, chrono::Utc::now().timestamp()).unwrap();
    assert!(due.is_empty(), "synced: due again in an hour");
    let later = connector_schedule::due_sources(&service, chrono::Utc::now().timestamp() + 3601).unwrap();
    assert_eq!(later.get(&knowledge_base.id), Some(&vec![hourly.id.clone()]));

    let changed = service
        .set_connector_schedule(
            &manual.id,
            graphrt_connect::SyncSchedule::Daily { time: "06:00".into(), timezone: "+07:00".into() },
        )
        .unwrap();
    assert!(changed.connector.unwrap().next_sync_at.is_some());
    assert!(
        service.set_connector_schedule(&manual.id, graphrt_connect::SyncSchedule::Every { secs: 10 }).is_err(),
        "too often"
    );
}
