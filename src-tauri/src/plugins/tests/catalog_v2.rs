//! Catalog v2: `index-v2.json` preferred over v1, the fallback, and the per-version
//! detail files (verification, disk cache, background sync, prune, consumers).

use super::super::catalog::{parse_catalog_v2, MAX_DETAIL_BYTES};
use super::super::details::{DetailRef, DETAILS_DIR_NAME};
use super::*;

const V2_URL: &str = "https://plugins.example.test/index-v2.json";

fn detail_url(name: &str, version: &str) -> String {
    format!("https://plugins.example.test/plugin-{name}-{version}.json")
}

/// A v2 publication made from a v1 catalog document: the index (nodes replaced by
/// `node_kinds` plus detail fields) and each entry's detail file `(url, bytes)`.
fn v2_publication(v1_catalog: &[u8]) -> (serde_json::Value, Vec<(String, Vec<u8>)>) {
    let mut index: serde_json::Value = serde_json::from_slice(v1_catalog).unwrap();
    index["schema"] = 2.into();
    let mut detail_files = Vec::new();
    for entry in index["plugins"].as_array_mut().unwrap() {
        let name = entry["name"].as_str().unwrap().to_owned();
        let version = entry["version"].as_str().unwrap().to_owned();
        let nodes = entry.as_object_mut().unwrap().remove("nodes").unwrap_or_else(|| serde_json::json!([]));
        let tools: Vec<serde_json::Value> = entry["tools"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|tool| serde_json::json!({ "name": tool, "description": "" }))
            .collect();
        let detail =
            serde_json::json!({ "schema": 2, "name": name, "version": version, "nodes": nodes, "tools": tools });
        let detail_bytes = serde_json::to_vec(&detail).unwrap();
        entry["node_kinds"] = nodes
            .as_array()
            .unwrap()
            .iter()
            .map(|node| serde_json::json!({ "kind": node["kind"], "title": node["title"] }))
            .collect();
        entry["detail_url"] = detail_url(&name, &version).into();
        entry["detail_sha256"] = super::super::archive::sha256_hex(&detail_bytes).into();
        entry["detail_size_bytes"] = detail_bytes.len().into();
        detail_files.push((detail_url(&name, &version), detail_bytes));
    }
    (index, detail_files)
}

impl Fixture {
    /// Publishes v1 and v2 (with details) for the echo plugin and the never-installed fixtures.
    fn publish_v2_with_extras(&self, version: &str, tarball: Vec<u8>) {
        self.publish_with_extras(version, tarball);
        let v1_catalog = self.downloader.files.lock().unwrap()[CATALOG_URL].clone();
        let (index, detail_files) = v2_publication(&v1_catalog);
        self.serve_v2(&index, detail_files);
    }

    fn serve_v2(&self, index: &serde_json::Value, detail_files: Vec<(String, Vec<u8>)>) {
        self.downloader.serve(V2_URL, serde_json::to_vec(index).unwrap());
        for (url, bytes) in detail_files {
            self.downloader.serve(&url, bytes);
        }
    }

    fn saved_detail_names(&self) -> Vec<String> {
        let dir = self.app_data.path().join(DETAILS_DIR_NAME);
        let mut names: Vec<String> = match std::fs::read_dir(dir) {
            Ok(entries) => {
                entries.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().into_owned()).collect()
            }
            Err(_) => Vec::new(),
        };
        names.sort();
        names
    }
}

fn mail_send_node(index: &super::super::models::CatalogIndex) -> super::super::models::CatalogNode {
    let mail = index.plugins.iter().find(|plugin| plugin.name == "fixture-mail").unwrap();
    mail.nodes.iter().find(|node| node.kind == "fixture-mail.send_mail").unwrap().clone()
}

#[tokio::test]
async fn v2_is_preferred_over_v1() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    let mut index: serde_json::Value =
        serde_json::from_slice(&fixture.downloader.files.lock().unwrap()[V2_URL]).unwrap();
    index["plugins"][0]["description"] = "Echoes text back (v2)".into();
    fixture.downloader.serve(V2_URL, serde_json::to_vec(&index).unwrap());

    let catalog = fixture.service.catalog(true).await.unwrap();

    assert_eq!(catalog.plugins[0].description, "Echoes text back (v2)");
    assert_eq!(fixture.downloader.request_count(CATALOG_URL), 0, "v1 is not fetched when v2 works");
    assert!(fixture.app_data.path().join(super::super::CATALOG_V2_CACHE_FILE_NAME).is_file());
    assert!(!fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME).exists());
    assert!(catalog.fetched_at.is_some());
}

#[tokio::test]
async fn v1_is_used_when_v2_is_missing() {
    let fixture = Fixture::new();
    fixture.publish_with_extras("1.0.0", good_tarball());

    let catalog = fixture.service.catalog(true).await.unwrap();

    assert_eq!(fixture.downloader.request_count(V2_URL), 1);
    assert_eq!(catalog.plugins.len(), 3);
    // v1 behaves as before: full nodes inline, no detail fetched.
    let index = fixture.service.known_catalog().unwrap();
    assert!(mail_send_node(&index).config_schema.is_some());
    fixture.service.wait_for_detail_sync().await;
    assert!(fixture.saved_detail_names().is_empty());
}

#[tokio::test]
async fn v1_is_used_when_v2_has_an_unknown_schema_or_is_not_json() {
    for v2_body in [br#"{ "schema": 3, "plugins": [] }"#.to_vec(), b"<html>not json</html>".to_vec()] {
        let fixture = Fixture::new();
        fixture.publish_with_extras("1.0.0", good_tarball());
        fixture.downloader.serve(V2_URL, v2_body);

        let catalog = fixture.service.catalog(true).await.unwrap();

        assert_eq!(catalog.plugins.len(), 3);
        assert_eq!(fixture.downloader.request_count(CATALOG_URL), 1);
        assert!(!fixture.app_data.path().join(super::super::CATALOG_V2_CACHE_FILE_NAME).exists());
    }
}

#[tokio::test]
async fn the_builder_reads_config_schemas_from_the_details() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;

    let guide = fixture.service.prompt_guide();

    assert!(guide.contains("`fixture-mail.send_mail` (Send mail): Sends one email."), "{guide}");
    assert!(guide.contains("Fields (* required): to* (string), body* (string)"), "{guide}");
    assert!(guide.contains("Outputs: data, next_cursor."), "{guide}");
    let registry = fixture.service.draft_node_registry();
    let flow_without_body = r#"
version: "1"
name: mail
graph:
  nodes:
    - { id: start, type: start }
    - { id: send, type: fixture-mail.send_mail, to: a@b.test }
    - { id: end, type: end }
  edges:
    - { source: start, target: send }
    - { source: send, target: end }
"#;
    let error = graphrt_core::Graph::from_text(flow_without_body, &registry).unwrap_err().to_string();
    assert!(error.contains("`body`"), "{error}");
}

#[tokio::test]
async fn before_its_detail_arrives_a_plugin_is_listed_by_its_node_kinds() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    fixture.downloader.forget(&detail_url("fixture-mail", "2.0.0"));
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;

    let index = fixture.service.known_catalog().unwrap();
    let send_mail = mail_send_node(&index);
    assert_eq!(send_mail.title, "Send mail");
    assert_eq!(send_mail.config_schema, None);
    let guide = fixture.service.prompt_guide();
    assert!(guide.contains("`fixture-mail.send_mail` (Send mail)"), "{guide}");
    assert!(!guide.contains("to* (string)"), "{guide}");
    // Requirements still know which plugin owns the kind.
    let flow =
        "version: \"1\"\nname: m\ngraph:\n  nodes:\n    - { id: send, type: fixture-mail.send_mail }\n  edges: []\n";
    let requirements = fixture.service.requirements(flow).unwrap();
    assert_eq!(requirements[0].name, "fixture-mail");
}

#[tokio::test]
async fn a_detail_with_another_checksum_is_refused() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    let url = detail_url("fixture-mail", "2.0.0");
    let mut tampered = fixture.downloader.files.lock().unwrap()[&url].clone();
    let last = tampered.len() - 2;
    tampered[last] = b' ';
    fixture.downloader.serve(&url, tampered);
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;

    let entry = fixture.service.catalog_entry("fixture-mail").await.unwrap();
    let error = fixture.service.details.fetch(&DetailRef::of(&entry).unwrap()).await.unwrap_err();

    assert!(matches!(error, AppError::InvalidInput(_)), "{error}");
    assert!(error.to_string().contains("checksum"), "{error}");
    assert!(!fixture.saved_detail_names().contains(&"fixture-mail-2.0.0.json".to_owned()));
    // The plugin page falls back to the kinds and titles of the index.
    let nodes = fixture.service.catalog_plugin_nodes("fixture-mail").await.unwrap();
    assert_eq!(nodes[0].title, "Send mail");
    assert_eq!(nodes[0].description, "");
}

#[tokio::test]
async fn the_detail_size_is_capped() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    let mut index: serde_json::Value =
        serde_json::from_slice(&fixture.downloader.files.lock().unwrap()[V2_URL]).unwrap();
    let mail =
        index["plugins"].as_array_mut().unwrap().iter_mut().find(|entry| entry["name"] == "fixture-mail").unwrap();
    let real_size = mail["detail_size_bytes"].as_u64().unwrap();
    mail["detail_size_bytes"] = (real_size - 1).into();
    fixture.downloader.serve(V2_URL, serde_json::to_vec(&index).unwrap());
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;

    let entry = fixture.service.catalog_entry("fixture-mail").await.unwrap();
    let reference = DetailRef::of(&entry).unwrap();
    assert!(fixture.service.details.fetch(&reference).await.is_err(), "larger than the index says");
    assert!(!fixture.saved_detail_names().contains(&"fixture-mail-2.0.0.json".to_owned()));

    // A size above the 1 MiB cap drops the detail fields; the entry stays listed.
    mail_entry_with_size(&mut index, MAX_DETAIL_BYTES + 1);
    let parsed = parse_catalog_v2(&serde_json::to_vec(&index).unwrap()).unwrap();
    let parsed_mail = parsed.plugins.iter().find(|plugin| plugin.name == "fixture-mail").unwrap();
    assert_eq!(parsed_mail.detail_url, None);
    assert_eq!(parsed_mail.node_kinds.len(), 2);
}

fn mail_entry_with_size(index: &mut serde_json::Value, size: u64) {
    let mail =
        index["plugins"].as_array_mut().unwrap().iter_mut().find(|entry| entry["name"] == "fixture-mail").unwrap();
    mail["detail_size_bytes"] = size.into();
}

#[test]
fn invalid_v2_fields_are_dropped_not_the_entry() {
    let (mut index, _) = v2_publication(&catalog_json_with_extras("1.0.0", TARBALL_URL, &"a".repeat(64), 1));
    let plugins = index["plugins"].as_array_mut().unwrap();
    plugins[0]["detail_url"] = "http://plugins.example.test/plain.json".into();
    plugins[1]["detail_sha256"] = "not-hex".into();
    plugins[2]["node_kinds"] =
        serde_json::json!([{ "kind": "fixture-browser.scrape", "title": "Scrape" }, { "title": "no kind" }, 7]);

    let parsed = parse_catalog_v2(&serde_json::to_vec(&index).unwrap()).unwrap();

    assert_eq!(parsed.plugins.len(), 3);
    assert_eq!(parsed.plugins[0].detail_url, None);
    assert_eq!(parsed.plugins[1].detail_url, None);
    assert_eq!(parsed.plugins[1].detail_sha256, None);
    assert!(parsed.plugins[2].detail_url.is_some());
    assert_eq!(parsed.plugins[2].node_kinds.len(), 1);
}

#[tokio::test]
async fn details_are_saved_and_used_offline_after_a_restart() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;
    assert_eq!(
        fixture.saved_detail_names(),
        vec!["fixture-browser-1.0.0.json", "fixture-echo-1.0.0.json", "fixture-mail-2.0.0.json"]
    );
    let urls: Vec<String> = fixture.downloader.files.lock().unwrap().keys().cloned().collect();
    for url in urls {
        fixture.downloader.forget(&url);
    }

    let restarted = fixture.restarted();
    restarted.refresh_catalog_for_builder().await;

    let index = restarted.known_catalog().unwrap();
    assert_eq!(index.schema, 2);
    assert!(mail_send_node(&index).config_schema.is_some());
    assert!(restarted.prompt_guide().contains("to* (string), body* (string)"));
    let offline_catalog = restarted.catalog(false).await.unwrap();
    assert!(offline_catalog.from_cache);
    assert_eq!(offline_catalog.fetched_at, None);
    let mail = offline_catalog.plugins.iter().find(|plugin| plugin.name == "fixture-mail").unwrap();
    assert_eq!(mail.nodes[0].description, "Sends one email.");
}

#[tokio::test]
async fn the_background_sync_fetches_only_missing_details_and_prunes_old_versions() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;
    assert_eq!(fixture.downloader.request_count(&detail_url("fixture-mail", "2.0.0")), 1);

    // The echo plugin gets a new version: only its detail is new.
    fixture.publish_v2_with_extras("1.0.1", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.service.wait_for_detail_sync().await;

    assert_eq!(fixture.downloader.request_count(&detail_url("fixture-echo", "1.0.1")), 1);
    assert_eq!(fixture.downloader.request_count(&detail_url("fixture-mail", "2.0.0")), 1);
    assert_eq!(fixture.downloader.request_count(&detail_url("fixture-browser", "1.0.0")), 1);
    assert_eq!(
        fixture.saved_detail_names(),
        vec!["fixture-browser-1.0.0.json", "fixture-echo-1.0.1.json", "fixture-mail-2.0.0.json"],
        "1.0.0 is no longer listed, so its detail is pruned"
    );
}

#[tokio::test]
async fn the_plugin_page_fetches_a_missing_detail_on_demand() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    // Abort the sync so the page has to fetch the detail itself.
    if let Some(sync) = fixture.service.detail_sync.lock().unwrap().take() {
        sync.abort();
    }

    let nodes = fixture.service.catalog_plugin_nodes("fixture-mail").await.unwrap();

    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].description, "Sends one email.");
    assert!(fixture.saved_detail_names().contains(&"fixture-mail-2.0.0.json".to_owned()));
    assert!(matches!(fixture.service.catalog_plugin_nodes("no-such-plugin").await, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn installing_from_v2_works_and_caches_the_detail() {
    let fixture = Fixture::new();
    fixture.publish_v2_with_extras("1.0.0", good_tarball());

    let installed = fixture.service.install(PLUGIN).await.unwrap();

    assert_eq!(installed.version, "1.0.0");
    assert!(fixture.saved_detail_names().contains(&"fixture-echo-1.0.0.json".to_owned()));
}
