//! Plugin service tests: installs from a local fixture catalog + tarball built
//! from `fixtures/plugins/fixture-echo`, served by an in-memory downloader.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;

use super::download::{Downloader, ProgressCallback};
use super::events::PluginEventSink;
use super::models::{PluginEvent, PluginInstallStage};
use super::{PluginService, PluginServiceConfig};
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::node_runtime::NodeRuntime;
use crate::storage::Database;

mod approval;
mod auto_update;
mod catalog_plugins;
mod catalog_v2;
mod plugin_display_names;
mod plugin_icons;
mod sideload;

const PLUGIN: &str = "fixture-echo";
/// Catalog entries of plugins the tests never install.
const NOT_INSTALLED_ENTRIES: &str = include_str!("../../fixtures/plugins/catalog-not-installed.json");
const CATALOG_URL: &str = "https://plugins.example.test/index.json";
const TARBALL_URL: &str = "https://plugins.example.test/fixture-echo-1.0.0.tar.gz";

/// Serializes tests that publish the process-wide snapshot.
pub(crate) static ACTIVE_SNAPSHOT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Default)]
pub(crate) struct FakeDownloader {
    files: Mutex<HashMap<String, Vec<u8>>>,
    /// Every URL asked for, in order.
    requests: Mutex<Vec<String>>,
}

impl FakeDownloader {
    fn serve(&self, url: &str, bytes: Vec<u8>) {
        self.files.lock().unwrap().insert(url.to_owned(), bytes);
    }

    fn forget(&self, url: &str) {
        self.files.lock().unwrap().remove(url);
    }

    /// How many times `url` was asked for.
    fn request_count(&self, url: &str) -> usize {
        self.requests.lock().unwrap().iter().filter(|requested| *requested == url).count()
    }
}

impl Downloader for FakeDownloader {
    fn fetch(
        &self,
        url: &str,
        max_bytes: u64,
        _timeout: Duration,
        progress: Option<ProgressCallback>,
    ) -> BoxFuture<'_, AppResult<Vec<u8>>> {
        let found = self.files.lock().unwrap().get(url).cloned();
        self.requests.lock().unwrap().push(url.to_owned());
        let url = url.to_owned();
        Box::pin(async move {
            let bytes = found.ok_or_else(|| AppError::NotFound(format!("download {url}")))?;
            if bytes.len() as u64 > max_bytes {
                return Err(AppError::InvalidInput("too large".into()));
            }
            if let Some(callback) = progress {
                callback(bytes.len() as u64, Some(bytes.len() as u64));
            }
            Ok(bytes)
        })
    }
}

#[derive(Debug, Default)]
struct RecordedEvents(Mutex<Vec<PluginEvent>>);

impl PluginEventSink for RecordedEvents {
    fn send(&self, event: PluginEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl RecordedEvents {
    fn stages(&self) -> Vec<PluginInstallStage> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                PluginEvent::InstallProgress { stage, .. } => Some(*stage),
                _ => None,
            })
            .collect()
    }
}

fn fixture_files() -> Vec<(String, Vec<u8>)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/plugins").join(PLUGIN);
    ["graphrt-plugin.json", "plugin.mjs"]
        .iter()
        .map(|file| (format!("{PLUGIN}/{file}"), std::fs::read(dir.join(file)).unwrap()))
        .collect()
}

/// A raw tar entry the `tar` builder would refuse to write (absolute or `..` paths, links).
enum RawEntry {
    File { path: &'static str, contents: &'static [u8] },
    Symlink { path: &'static str, target: &'static str },
}

fn tarball(files: &[(String, Vec<u8>)], raw_entries: &[RawEntry]) -> Vec<u8> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    let mut dir_header = tar::Header::new_gnu();
    dir_header.set_entry_type(tar::EntryType::Directory);
    dir_header.set_mode(0o755);
    dir_header.set_size(0);
    builder.append_data(&mut dir_header, format!("{PLUGIN}/"), std::io::empty()).unwrap();
    for (path, contents) in files {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(contents.len() as u64);
        builder.append_data(&mut header, path, contents.as_slice()).unwrap();
    }
    for raw in raw_entries {
        let mut header = tar::Header::new_old();
        let (path, contents, entry_type): (&str, &[u8], _) = match raw {
            RawEntry::File { path, contents } => (path, contents, tar::EntryType::Regular),
            RawEntry::Symlink { path, target } => {
                header.set_link_name(target).unwrap();
                (path, &[], tar::EntryType::Symlink)
            }
        };
        header.set_entry_type(entry_type);
        header.set_mode(0o644);
        header.set_size(contents.len() as u64);
        let name = &mut header.as_old_mut().name;
        name[..path.len()].copy_from_slice(path.as_bytes());
        header.set_cksum();
        builder.append(&header, contents).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn good_tarball() -> Vec<u8> {
    tarball(&fixture_files(), &[])
}

fn catalog_json(version: &str, tarball_url: &str, sha256: &str, size_bytes: usize) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "schema": 1,
        "generated_at": "2026-11-01T00:00:00Z",
        "plugins": [{
            "name": PLUGIN,
            "version": version,
            "description": "Echoes text back",
            "tarball_url": tarball_url,
            "sha256": sha256,
            "size_bytes": size_bytes,
            "permissions": { "network": false, "secrets": true, "env": ["FIXTURE_ECHO_TOKEN"] },
            "needs_browser": true,
            "node": ">=20",
            "nodes": [{ "kind": "fixture-echo.echo", "title": "Echo text", "description": "Returns the text" }],
            "tools": ["echo"],
            "readme_url": "https://plugins.example.test/README.md"
        }]
    }))
    .unwrap()
}

/// `catalog_json` plus the never-installed fixture plugins.
fn catalog_json_with_extras(version: &str, tarball_url: &str, sha256: &str, size_bytes: usize) -> Vec<u8> {
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json(version, tarball_url, sha256, size_bytes)).unwrap();
    let extras: Vec<serde_json::Value> = serde_json::from_str(NOT_INSTALLED_ENTRIES).unwrap();
    catalog["plugins"].as_array_mut().unwrap().extend(extras);
    serde_json::to_vec(&catalog).unwrap()
}

/// A catalog of only the never-installed fixture plugins (`fixture-mail`, `fixture-browser`).
pub(crate) fn not_installed_catalog() -> super::models::CatalogIndex {
    catalog_of_entries(NOT_INSTALLED_ENTRIES)
}

/// A catalog of the real `google-maps-scraper` and `whatsapp-web` entries (node kinds and
/// fields copied from their manifests in graphrt-plugins), never installed.
pub(crate) fn maps_whatsapp_catalog() -> super::models::CatalogIndex {
    catalog_of_entries(include_str!("../../fixtures/plugins/catalog-maps-whatsapp.json"))
}

fn catalog_of_entries(entries_json: &str) -> super::models::CatalogIndex {
    let entries: Vec<serde_json::Value> = serde_json::from_str(entries_json).unwrap();
    let catalog = serde_json::json!({ "schema": 1, "plugins": entries });
    super::catalog::parse_catalog(&serde_json::to_vec(&catalog).unwrap()).unwrap()
}

/// What the fixture catalog entry says the echo plugin asks for (what the install card shows).
pub(crate) fn echo_catalog_permissions() -> super::models::PluginPermissions {
    super::models::PluginPermissions { network: false, secrets: true, env: vec!["FIXTURE_ECHO_TOKEN".into()] }
}

/// Trusts an installed plugin the way its trust toggle does: approving what it asks for.
pub(crate) async fn trust(service: &PluginService, name: &str) -> AppResult<super::models::InstalledPlugin> {
    let approved = service.installed(name)?.permissions;
    service.set_trusted(name, true, Some(&approved)).await
}

pub(crate) struct Fixture {
    pub app_data: tempfile::TempDir,
    pub service: PluginService,
    downloader: Arc<FakeDownloader>,
    events: Arc<RecordedEvents>,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
}

impl Fixture {
    fn new() -> Self {
        let app_data = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open_in_memory().unwrap());
        let credentials = Arc::new(CredentialStore::in_memory());
        let downloader = Arc::new(FakeDownloader::default());
        let events = Arc::new(RecordedEvents::default());
        let service = build_service(app_data.path(), &db, &credentials, &downloader, &events);
        Self { app_data, service, downloader, events, db, credentials }
    }

    /// Serves `tarball` and a catalog pointing at it with its real checksum.
    fn publish(&self, version: &str, tarball: Vec<u8>) {
        let sha = super::archive::sha256_hex(&tarball);
        self.downloader.serve(CATALOG_URL, catalog_json(version, TARBALL_URL, &sha, tarball.len()));
        self.downloader.serve(TARBALL_URL, tarball);
    }

    /// Like [`Fixture::publish`], with the never-installed fixture plugins in the catalog too.
    fn publish_with_extras(&self, version: &str, tarball: Vec<u8>) {
        let sha = super::archive::sha256_hex(&tarball);
        self.downloader.serve(CATALOG_URL, catalog_json_with_extras(version, TARBALL_URL, &sha, tarball.len()));
        self.downloader.serve(TARBALL_URL, tarball);
    }

    fn plugins_dir(&self) -> PathBuf {
        self.app_data.path().join("plugins")
    }

    /// Names in the plugin folder (staging leftovers included).
    fn plugin_folder_entries(&self) -> Vec<String> {
        match std::fs::read_dir(self.plugins_dir()) {
            Ok(entries) => {
                entries.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().into_owned()).collect()
            }
            Err(_) => Vec::new(),
        }
    }

    /// A second service over the same app data, database and keychain (an app restart).
    fn restarted(&self) -> PluginService {
        build_service(self.app_data.path(), &self.db, &self.credentials, &self.downloader, &self.events)
    }
}

fn build_service(
    app_data: &Path,
    db: &Arc<Database>,
    credentials: &Arc<CredentialStore>,
    downloader: &Arc<FakeDownloader>,
    events: &Arc<RecordedEvents>,
) -> PluginService {
    PluginService::new(PluginServiceConfig {
        app_data_dir: app_data.to_path_buf(),
        catalog_url: CATALOG_URL.to_owned(),
        db: db.clone(),
        credentials: credentials.clone(),
        node_runtime: Arc::new(NodeRuntime::new(app_data.to_path_buf())),
        downloader: downloader.clone(),
        events: events.clone(),
    })
}

/// A fixture with the echo plugin installed.
pub(crate) async fn installed_fixture() -> Fixture {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    fixture
}

fn assert_nothing_installed(fixture: &Fixture) {
    assert_eq!(fixture.plugin_folder_entries(), Vec::<String>::new());
    assert!(fixture.service.list_installed().unwrap().is_empty());
    assert!(!fixture.service.node_registry().contains("fixture-echo.echo"));
}

#[tokio::test]
async fn install_from_catalog_loads_the_plugin_and_its_node_kinds() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());

    let installed = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();

    assert_eq!(installed.version, "1.0.0");
    assert!(installed.needs_browser);
    assert!(!installed.trusted);
    assert_eq!(installed.load_error, None);
    assert_eq!(installed.nodes.len(), 2);
    assert_eq!(installed.permissions.env, vec!["FIXTURE_ECHO_TOKEN".to_owned()]);
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()]);
    let registry = fixture.service.node_registry();
    assert!(registry.contains("fixture-echo.echo"));
    assert!(registry.contains("fixture-echo.send_text"));
    assert!(fixture.service.snapshot().tools.get(PLUGIN).is_some());
    let stages = fixture.events.stages();
    assert_eq!(stages.first(), Some(&PluginInstallStage::Downloading));
    assert_eq!(stages.last(), Some(&PluginInstallStage::Done));
}

#[tokio::test]
async fn removing_a_plugin_drops_its_kinds_trust_and_settings() {
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token-value").await.unwrap();

    fixture.service.remove(PLUGIN).await.unwrap();

    assert_nothing_installed(&fixture);
    assert!(!fixture.credentials.has_plugin_config(PLUGIN, "FIXTURE_ECHO_TOKEN").unwrap());
    assert!(super::settings::trusted_plugins(&fixture.db).unwrap().is_empty());
    assert!(matches!(fixture.service.remove(PLUGIN).await, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn checksum_mismatch_with_the_catalog_is_rejected() {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    fixture.downloader.serve(CATALOG_URL, catalog_json("1.0.0", TARBALL_URL, &"0".repeat(64), tarball.len()));
    fixture.downloader.serve(TARBALL_URL, tarball);

    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("checksum")), "{error}");
    assert_nothing_installed(&fixture);
    assert_eq!(fixture.events.stages().last(), Some(&PluginInstallStage::Failed));
}

async fn assert_archive_rejected(raw_entries: &[RawEntry]) -> Fixture {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", tarball(&fixture_files(), raw_entries));
    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();
    assert!(matches!(error, AppError::InvalidInput(_)), "{error}");
    assert_nothing_installed(&fixture);
    fixture
}

#[tokio::test]
async fn path_traversal_entries_are_rejected() {
    let fixture =
        assert_archive_rejected(&[RawEntry::File { path: "fixture-echo/../../evil.txt", contents: b"x" }]).await;
    assert!(!fixture.app_data.path().join("evil.txt").exists());
    assert!(!fixture.app_data.path().parent().unwrap().join("evil.txt").exists());
}

#[tokio::test]
async fn absolute_paths_are_rejected() {
    assert_archive_rejected(&[RawEntry::File { path: "/tmp/graphrt-evil.txt", contents: b"x" }]).await;
}

#[tokio::test]
async fn symlinks_are_rejected() {
    assert_archive_rejected(&[RawEntry::Symlink { path: "fixture-echo/link", target: "/etc/passwd" }]).await;
}

#[tokio::test]
async fn files_outside_the_plugin_folder_are_rejected() {
    assert_archive_rejected(&[RawEntry::File { path: "other-plugin/plugin.mjs", contents: b"x" }]).await;
}

/// The fixture tarball preceded by one extension header (`entry_type`) of `size` bytes of `fill`.
fn tarball_with_extension_header(entry_type: tar::EntryType, size: usize, fill: &[u8]) -> Vec<u8> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    let mut extension = tar::Header::new_gnu();
    extension.set_entry_type(entry_type);
    extension.set_mode(0o644);
    extension.set_size(size as u64);
    let name = &mut extension.as_gnu_mut().unwrap().name;
    name[..13].copy_from_slice(b"././@LongLink");
    extension.set_cksum();
    let contents: Vec<u8> = fill.iter().copied().cycle().take(size).collect();
    builder.append(&extension, contents.as_slice()).unwrap();
    for (path, contents) in fixture_files() {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(contents.len() as u64);
        builder.append_data(&mut header, path, contents.as_slice()).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

async fn assert_tarball_rejected(tarball_bytes: Vec<u8>, expected_message: &str) {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", tarball_bytes.clone());
    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();
    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains(expected_message)), "{error}");
    assert_nothing_installed(&fixture);
    let sideload_error = super::archive::tarball_top_dir(&tarball_bytes).unwrap_err();
    assert!(sideload_error.to_string().contains(expected_message), "{sideload_error}");
}

#[tokio::test]
async fn oversized_gnu_long_names_and_links_are_rejected_before_they_are_read() {
    let one_mib = 1024 * 1024;
    assert_tarball_rejected(tarball_with_extension_header(tar::EntryType::GNULongName, one_mib, b"a"), "header").await;
    assert_tarball_rejected(tarball_with_extension_header(tar::EntryType::GNULongLink, one_mib, b"b"), "header").await;
}

#[tokio::test]
async fn oversized_pax_headers_are_rejected_before_they_are_read() {
    let one_mib = 1024 * 1024;
    let record = b"30 comment=aaaaaaaaaaaaaaaaaaa\n";
    assert_tarball_rejected(tarball_with_extension_header(tar::EntryType::XHeader, one_mib, record), "header").await;
    assert_tarball_rejected(tarball_with_extension_header(tar::EntryType::XGlobalHeader, one_mib, record), "header")
        .await;
}

#[tokio::test]
async fn pax_headers_that_change_an_entry_size_are_rejected() {
    let record = b"16 size=1000000\n";
    assert_tarball_rejected(tarball_with_extension_header(tar::EntryType::XHeader, record.len(), record), "size").await;
}

#[test]
fn small_extension_headers_are_still_accepted() {
    let long_name = b"fixture-echo/README.md\0";
    let bytes = tarball_with_extension_header(tar::EntryType::GNULongName, long_name.len(), long_name);
    let destination = tempfile::tempdir().unwrap();
    let plugin_dir = super::archive::extract_plugin_tarball(&bytes, PLUGIN, destination.path()).unwrap();
    // The long name renames the entry after it (the manifest).
    assert!(plugin_dir.join("README.md").is_file());
    assert!(plugin_dir.join("plugin.mjs").is_file());
}

#[tokio::test]
async fn a_plugin_failing_its_manifest_checksums_leaves_nothing_behind() {
    let mut files = fixture_files();
    files[1].1.extend_from_slice(b"\n// tampered\n");
    let fixture = Fixture::new();
    fixture.publish("1.0.0", tarball(&files, &[]));

    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("checksum")), "{error}");
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn a_failed_update_keeps_the_installed_version() {
    let fixture = installed_fixture().await;
    let mut files = fixture_files();
    files[1].1.extend_from_slice(b"\n// tampered\n");
    fixture.publish("1.0.1", tarball(&files, &[]));
    fixture.service.catalog(true).await.unwrap();

    assert!(fixture.service.update(PLUGIN).await.is_err());

    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()]);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");
    assert!(fixture.service.node_registry().contains("fixture-echo.echo"));
}

#[tokio::test]
async fn an_update_asking_for_more_permissions_drops_trust() {
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    files[0].1 = manifest
        .replace("\"version\": \"1.0.0\"", "\"version\": \"1.1.0\"")
        .replace("\"env\": [\"FIXTURE_ECHO_TOKEN\"]", "\"env\": [\"FIXTURE_ECHO_TOKEN\", \"FIXTURE_ECHO_EXTRA\"]")
        .into_bytes();
    fixture.publish("1.1.0", tarball(&files, &[]));
    fixture.service.catalog(true).await.unwrap();

    let updated = fixture.service.update(PLUGIN).await.unwrap();

    assert_eq!(updated.version, "1.1.0");
    assert!(!updated.trusted);
}

#[tokio::test]
async fn installed_settings_say_whether_they_are_optional() {
    let fixture = installed_fixture().await;
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    files[0].1 = manifest
        .replace("\"version\": \"1.0.0\"", "\"version\": \"1.1.0\"")
        .replace(
            "\"env\": [\"FIXTURE_ECHO_TOKEN\"]",
            "\"env\": [\"FIXTURE_ECHO_TOKEN\", \"FIXTURE_ECHO_IDLE_MINUTES\"]",
        )
        .into_bytes();
    fixture.publish("1.1.0", tarball(&files, &[]));
    fixture.service.catalog(true).await.unwrap();

    let updated = fixture.service.update(PLUGIN).await.unwrap();

    let optional_by_name: Vec<(&str, bool)> =
        updated.config.iter().map(|status| (status.name.as_str(), status.optional)).collect();
    assert_eq!(optional_by_name, [("FIXTURE_ECHO_TOKEN", false), ("FIXTURE_ECHO_IDLE_MINUTES", true)]);
    let listing = serde_json::to_value(&updated).unwrap();
    assert_eq!(listing["config"][1]["optional"], true);
}

#[tokio::test]
async fn non_https_downloads_are_refused() {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    let sha = super::archive::sha256_hex(&tarball);
    fixture.downloader.serve(CATALOG_URL, catalog_json("1.0.0", "http://plugins.example.test/p.tar.gz", &sha, 10));

    // The entry is dropped from the catalog, so it cannot be installed.
    assert!(fixture.service.catalog(true).await.unwrap().plugins.is_empty());
    assert!(matches!(fixture.service.install(PLUGIN, &echo_catalog_permissions()).await, Err(AppError::NotFound(_))));
    assert!(super::download::require_https("http://example.com/index.json").is_err());
    assert!(super::download::require_https("file:///etc/passwd").is_err());
}

#[tokio::test]
async fn catalog_shows_installed_versions_and_updates() {
    let fixture = installed_fixture().await;
    let catalog = fixture.service.catalog(false).await.unwrap();
    let entry = &catalog.plugins[0];
    assert_eq!(entry.installed_version.as_deref(), Some("1.0.0"));
    assert!(!entry.update_available);
    assert!(entry.needs_browser);

    fixture.publish("1.0.1", good_tarball());
    let refreshed = fixture.service.catalog(true).await.unwrap();
    assert!(refreshed.plugins[0].update_available);
    assert!(!refreshed.from_cache);
}

#[tokio::test]
async fn readme_links_come_from_the_installed_plugin_or_the_catalog() {
    let fixture = installed_fixture().await;
    assert_eq!(fixture.service.readme_url(PLUGIN).unwrap(), "https://plugins.example.test/README.md");
    assert!(matches!(fixture.service.readme_url("no-such-plugin"), Err(AppError::NotFound(_))));
}

#[test]
fn catalog_view_carries_the_warning_maturity_and_tos_risk() {
    let catalog = super::catalog::catalog_view(&not_installed_catalog(), &[], Default::default());
    let mail = catalog.plugins.iter().find(|entry| entry.name == "fixture-mail").unwrap();
    assert_eq!(mail.warning.as_deref(), Some("Sending bulk mail may get the account blocked."));
    assert_eq!(mail.status.as_deref(), Some("beta"));
    assert_eq!(mail.tos_risk.as_deref(), Some("medium"));
    let browser = catalog.plugins.iter().find(|entry| entry.name == "fixture-browser").unwrap();
    assert_eq!(browser.status, None);
}

#[tokio::test]
async fn catalog_falls_back_to_the_saved_copy_when_offline() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.downloader.forget(CATALOG_URL);

    let catalog = fixture.restarted().catalog(false).await.unwrap();

    assert!(catalog.from_cache);
    assert_eq!(catalog.plugins.len(), 1);
}

#[tokio::test]
async fn catalog_larger_than_two_mib_is_accepted() {
    // 146 plugins with their node config schemas already make a 3.5 MB indented catalog.
    let fixture = Fixture::new();
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &"a".repeat(64), 1)).unwrap();
    catalog["plugins"][0]["description"] = serde_json::Value::from("x".repeat(3_500_000));
    fixture.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());

    let listed = fixture.service.catalog(true).await.unwrap();

    assert_eq!(listed.plugins.len(), 1);
    assert!(!listed.from_cache);
}

#[tokio::test]
async fn catalog_over_the_limit_is_rejected() {
    let fixture = Fixture::new();
    let oversized = vec![b' '; usize::try_from(super::catalog::MAX_CATALOG_BYTES).unwrap() + 1];
    fixture.downloader.serve(CATALOG_URL, oversized);
    assert!(fixture.service.catalog(true).await.is_err());
}

#[tokio::test]
async fn catalog_with_an_unknown_schema_is_rejected() {
    let fixture = Fixture::new();
    fixture.downloader.serve(CATALOG_URL, br#"{"schema": 2, "plugins": []}"#.to_vec());
    assert!(matches!(fixture.service.catalog(true).await, Err(AppError::InvalidInput(_))));
}

#[tokio::test]
async fn trust_and_settings_persist_across_restarts() {
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    let configured = fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token-value").await.unwrap();
    assert!(configured.config.iter().all(|status| status.configured));

    let restarted = fixture.restarted();
    let installed = restarted.installed(PLUGIN).unwrap();
    assert!(installed.trusted);
    assert_eq!(installed.config.len(), 1);
    assert!(installed.config[0].configured);
    assert!(restarted.snapshot().host.plugins()[0].trusted);

    let cleared = restarted.delete_config(PLUGIN, "FIXTURE_ECHO_TOKEN").await.unwrap();
    assert!(!cleared.config[0].configured);
    let untrusted = restarted.set_trusted(PLUGIN, false, None).await.unwrap();
    assert!(!untrusted.trusted);
}

#[tokio::test]
async fn settings_the_plugin_does_not_request_are_refused() {
    let fixture = installed_fixture().await;
    let error = fixture.service.set_config(PLUGIN, "HOME", "/tmp").await.unwrap_err();
    assert!(matches!(error, AppError::InvalidInput(_)));
    assert!(matches!(trust(&fixture.service, "missing").await, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn setting_values_never_appear_in_listings_or_debug_output() {
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "very-secret-token").await.unwrap();
    let listing = serde_json::to_string(&fixture.service.list_installed().unwrap()).unwrap();
    assert!(!listing.contains("very-secret-token"));
    assert!(!format!("{:?}", fixture.service).contains("very-secret-token"));
}

#[tokio::test]
async fn prompt_guide_lists_installed_plugin_steps() {
    let fixture = Fixture::new();
    assert_eq!(fixture.service.prompt_guide(), "");
    fixture.publish("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();

    let guide = fixture.service.prompt_guide();

    assert!(guide.contains("`fixture-echo.echo` (Echo text)"), "{guide}");
    assert!(guide.contains("text* (string)"), "{guide}");
    assert!(guide.contains("instead of a raw `http-request`"), "{guide}");
    // Settings the app configures (access tokens) are not offered to the model.
    assert!(!guide.contains("access_token ("), "{guide}");
    assert!(guide.contains("fixture-echo.send_text"));
}

#[tokio::test]
async fn actions_are_refused_for_untrusted_plugins_and_undeclared_kinds() {
    let fixture = installed_fixture().await;
    let untrusted = fixture.service.run_action(PLUGIN, "fixture-echo.echo", serde_json::json!({ "text": "hi" })).await;
    assert!(matches!(untrusted, Err(AppError::InvalidInput(message)) if message.contains("trust")));

    trust(&fixture.service, PLUGIN).await.unwrap();
    let undeclared = fixture.service.run_action(PLUGIN, "fixture-echo.format_disk", serde_json::Value::Null).await;
    assert!(matches!(undeclared, Err(AppError::InvalidInput(_))));
    let other_namespace = fixture.service.run_action(PLUGIN, "http-request", serde_json::Value::Null).await;
    assert!(matches!(other_namespace, Err(AppError::InvalidInput(_))));
    let reserved = fixture.service.run_action(PLUGIN, "fixture-echo.echo", serde_json::json!({ "type": "code" })).await;
    assert!(matches!(reserved, Err(AppError::InvalidInput(_))));
    let not_object = fixture.service.run_action(PLUGIN, "fixture-echo.echo", serde_json::json!([1])).await;
    assert!(matches!(not_object, Err(AppError::InvalidInput(_))));
    let unknown = fixture.service.run_action("missing", "missing.echo", serde_json::Value::Null).await;
    assert!(matches!(unknown, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn a_broken_plugin_folder_is_reported_without_hiding_the_others() {
    let fixture = installed_fixture().await;
    let broken = fixture.plugins_dir().join("broken");
    std::fs::create_dir_all(&broken).unwrap();
    std::fs::write(broken.join("graphrt-plugin.json"), "{ not json").unwrap();

    let restarted = fixture.restarted();
    let installed = restarted.list_installed().unwrap();

    assert_eq!(installed.len(), 2);
    assert!(installed.iter().any(|plugin| plugin.name == "broken" && plugin.load_error.is_some()));
    assert!(restarted.node_registry().contains("fixture-echo.echo"));
    let load_errors =
        fixture.events.0.lock().unwrap().iter().filter(|event| matches!(event, PluginEvent::LoadError { .. })).count();
    assert!(load_errors >= 1);
}

#[tokio::test]
async fn the_published_snapshot_feeds_compiles_tools_and_the_approval_check() {
    let fixture = installed_fixture().await;
    let _lock = ACTIVE_SNAPSHOT_LOCK.lock().await;
    fixture.service.activate();

    let flow = "version: \"1\"\nname: echo\ngraph:\n  nodes:\n    - { id: start, type: start }\n    \
                - { id: say, type: fixture-echo.send_text, title: Send it, text: hi }\n  edges:\n    \
                - { source: start, target: say }\n";
    let compiled = crate::flow::compile_flow(flow);
    let unapproved = crate::flow::find_unapproved_sending_steps(flow);
    let mut tools = graphrt_core::tool::ToolRegistry::new();
    super::add_plugin_tools(&mut tools);
    let guide = super::installed_plugins_guide();
    fixture.service.remove(PLUGIN).await.unwrap();
    let after_remove = crate::flow::node_registry().contains("fixture-echo.echo");
    super::active::publish(None);
    super::active::publish_catalog(None);

    assert!(compiled.is_ok(), "{:?}", compiled.err());
    assert_eq!(unapproved.unwrap(), vec!["Send it".to_owned()]);
    assert!(tools.get(PLUGIN).is_some());
    assert!(guide.contains("fixture-echo.echo"));
    assert!(!after_remove);
}

#[test]
fn sending_plugin_kinds_are_recognized() {
    assert!(super::is_sending_plugin_kind("whatsapp-api.send_text"));
    assert!(super::is_sending_plugin_kind("x-api.create_post"));
    assert!(!super::is_sending_plugin_kind("whatsapp-web.get_status"));
    assert!(!super::is_sending_plugin_kind("http-request"));
}

fn node_is_available() -> bool {
    std::process::Command::new("node").arg("--version").output().is_ok_and(|output| output.status.success())
}

/// Runs the fixture plugin on a real Node process; skipped when Node is not on PATH.
#[tokio::test]
async fn actions_run_the_plugin_with_keychain_settings_only() {
    if !node_is_available() {
        eprintln!("skipping: node is not on PATH");
        return;
    }
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();

    let without_setting =
        fixture.service.run_action(PLUGIN, "fixture-echo.echo", serde_json::json!({ "text": "hello" })).await.unwrap();
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token-from-keychain").await.unwrap();
    let with_setting =
        fixture.service.run_action(PLUGIN, "fixture-echo.echo", serde_json::json!({ "text": "hello" })).await.unwrap();

    assert_eq!(without_setting.outputs["data"]["echo"], "hello");
    assert_eq!(without_setting.outputs["data"]["token_received"], serde_json::Value::Null);
    assert_eq!(with_setting.outputs["data"]["token_received"], "token-from-keychain");
    assert_eq!(with_setting.outputs["data"]["unrelated_env_visible"], false);
}

/// Installs every plugin of the published catalog over the network
/// (`cargo test live_catalog -- --ignored`).
#[tokio::test]
#[ignore = "downloads the live catalog from GitHub"]
async fn live_catalog_installs_every_plugin() {
    let app_data = tempfile::tempdir().unwrap();
    let service = PluginService::new(PluginServiceConfig {
        app_data_dir: app_data.path().to_path_buf(),
        catalog_url: super::DEFAULT_CATALOG_URL.to_owned(),
        db: Arc::new(Database::open_in_memory().unwrap()),
        credentials: Arc::new(CredentialStore::in_memory()),
        node_runtime: Arc::new(NodeRuntime::new(app_data.path().to_path_buf())),
        downloader: Arc::new(super::download::HttpsDownloader::new().unwrap()),
        events: Arc::new(RecordedEvents::default()),
    });
    let catalog = service.catalog(true).await.unwrap();
    assert!(!catalog.plugins.is_empty());
    for entry in &catalog.plugins {
        let installed = service
            .install(&entry.name, &entry.permissions)
            .await
            .unwrap_or_else(|error| panic!("{}: {error}", entry.name));
        assert_eq!(installed.load_error, None, "{}", entry.name);
        assert!(service.node_registry().contains(&entry.nodes[0].kind), "{}", entry.name);
    }
    if node_is_available() {
        trust(&service, "whatsapp-api").await.unwrap();
        let tools = service.snapshot();
        assert!(tools.tools.get("whatsapp-api").is_some());
    }
}

#[tokio::test]
async fn removing_all_plugins_clears_folders_and_keeps_settings_unless_asked() {
    let fixture = installed_fixture().await;
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token-value").await.unwrap();
    let profile_dir = fixture.app_data.path().join("plugin-data").join(PLUGIN).join("profile");
    std::fs::create_dir_all(&profile_dir).unwrap();

    assert_eq!(fixture.service.remove_all(false).await, 1);

    assert_nothing_installed(&fixture);
    assert!(!fixture.app_data.path().join("plugin-data").exists());
    assert!(fixture.credentials.has_plugin_config(PLUGIN, "FIXTURE_ECHO_TOKEN").unwrap());
}

#[tokio::test]
async fn removing_all_plugins_with_settings_also_clears_the_keychain() {
    let fixture = installed_fixture().await;
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token-value").await.unwrap();

    assert_eq!(fixture.service.remove_all(true).await, 1);

    assert_nothing_installed(&fixture);
    assert!(!fixture.credentials.has_plugin_config(PLUGIN, "FIXTURE_ECHO_TOKEN").unwrap());
}

#[tokio::test]
async fn removing_all_plugins_when_none_are_installed_is_a_no_op() {
    let fixture = Fixture::new();
    assert_eq!(fixture.service.remove_all(true).await, 0);
}
