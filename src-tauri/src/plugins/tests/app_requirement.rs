//! Plugins that need a newer app (`min_app_version` in the catalog): what the Plugins screen
//! is told, that installs and updates are refused before anything is downloaded, that
//! automatic updates leave them alone, and that a plugin made for a newer app says so when
//! it is installed from a folder or archive.

use super::*;
use crate::plugins::auto_update::plan_updates;
use crate::plugins::models::{CatalogIndex, NewerAppNeeded};

impl Fixture {
    /// Serves `tarball` with a catalog whose entry says `min_app_version` (any JSON value).
    fn publish_needing_app(&self, version: &str, tarball: Vec<u8>, min_app_version: serde_json::Value) {
        let sha = super::super::archive::sha256_hex(&tarball);
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&catalog_json(version, TARBALL_URL, &sha, tarball.len())).unwrap();
        catalog["plugins"][0]["min_app_version"] = min_app_version;
        self.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
        self.downloader.serve(TARBALL_URL, tarball);
    }

    /// The same app data as an app of `app_version` would see it.
    fn as_app_version(&self, app_version: &str) -> PluginService {
        self.restarted().with_app_version(app_version)
    }
}

/// The fixture files with one manifest key no released graphrt knows.
fn files_from_a_newer_app() -> Vec<(String, Vec<u8>)> {
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    assert!(manifest.starts_with("{\n"), "the fixture manifest starts with an object");
    files[0].1 = manifest.replacen("{\n", "{\n  \"holograms\": [],\n", 1).into_bytes();
    files
}

fn needed(min_version: Option<&str>) -> Option<NewerAppNeeded> {
    Some(NewerAppNeeded { min_version: min_version.map(str::to_owned) })
}

fn assert_needs_newer_app(error: &AppError, expected_min_version: Option<&str>) {
    assert!(
        matches!(error, AppError::NeedsNewerApp { min_version, .. } if min_version.as_deref() == expected_min_version),
        "{error:?}"
    );
    assert_eq!(error.code(), "needs_newer_app");
}

fn parse_v1(catalog: &serde_json::Value) -> CatalogIndex {
    super::super::catalog::parse_catalog(&serde_json::to_vec(catalog).unwrap()).unwrap()
}

#[test]
fn the_catalog_keeps_min_app_version_and_stays_readable_whatever_it_holds() {
    let entry = |min_app_version: Option<serde_json::Value>| {
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &"a".repeat(64), 10)).unwrap();
        if let Some(value) = min_app_version {
            catalog["plugins"][0]["min_app_version"] = value;
        }
        let index = parse_v1(&catalog);
        assert_eq!(index.plugins.len(), 1, "the entry stays listed");
        index.plugins[0].min_app_version.clone()
    };
    assert_eq!(entry(None), None);
    assert_eq!(entry(Some(serde_json::Value::Null)), None);
    assert_eq!(entry(Some("0.2.0".into())).as_deref(), Some("0.2.0"));
    // A form this app does not know is kept as text, so it reads as "needs a newer app".
    assert_eq!(entry(Some(serde_json::json!(3))).as_deref(), Some("3"));
    assert_eq!(entry(Some(serde_json::json!({ "desktop": "0.9.0" }))).as_deref(), Some("{\"desktop\":\"0.9.0\"}"));
}

#[test]
fn a_v2_index_carries_min_app_version_too() {
    let catalog = serde_json::json!({
        "schema": 2,
        "plugins": [{
            "name": PLUGIN, "version": "1.0.0", "tarball_url": TARBALL_URL, "sha256": "a".repeat(64),
            "node_kinds": [{ "kind": "fixture-echo.echo", "title": "Echo text" }],
            "min_app_version": "0.3.0"
        }]
    });
    let index = super::super::catalog::parse_catalog_v2(&serde_json::to_vec(&catalog).unwrap()).unwrap();
    assert_eq!(index.plugins[0].min_app_version.as_deref(), Some("0.3.0"));
}

#[tokio::test]
async fn the_plugins_screen_is_told_which_plugins_need_a_newer_app() {
    let fixture = Fixture::new();
    fixture.publish_needing_app("1.0.0", good_tarball(), "0.3.0".into());

    let older = fixture.as_app_version("0.2.1").catalog(true).await.unwrap();
    assert_eq!(older.plugins[0].needs_newer_app, needed(Some("0.3.0")));
    let serialized = serde_json::to_value(&older.plugins[0]).unwrap();
    assert_eq!(serialized["needsNewerApp"], serde_json::json!({ "minVersion": "0.3.0" }));

    for new_enough in ["0.3.0", "0.3.1", "0.10.0", "1.0.0"] {
        let catalog = fixture.as_app_version(new_enough).catalog(true).await.unwrap();
        assert_eq!(catalog.plugins[0].needs_newer_app, None, "{new_enough}");
        assert_eq!(serde_json::to_value(&catalog.plugins[0]).unwrap()["needsNewerApp"], serde_json::Value::Null);
    }
}

#[tokio::test]
async fn a_plugin_without_a_minimum_installs_on_any_app_version() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    let service = fixture.as_app_version("0.0.1");

    assert_eq!(service.catalog(true).await.unwrap().plugins[0].needs_newer_app, None);
    assert_eq!(service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap().version, "1.0.0");
}

#[tokio::test]
async fn installing_a_plugin_that_needs_a_newer_app_is_refused_before_any_download() {
    let fixture = Fixture::new();
    fixture.publish_needing_app("1.0.0", good_tarball(), "0.3.0".into());
    let service = fixture.as_app_version("0.2.1");

    let error = service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert_needs_newer_app(&error, Some("0.3.0"));
    let message = error.to_string();
    assert!(message.contains("needs Graphrt Desktop 0.3.0 or newer"), "{message}");
    assert!(message.contains("Update Graphrt Desktop"), "{message}");
    assert!(!message.contains("unknown field") && !message.contains("manifest"), "{message}");
    assert_eq!(fixture.downloader.request_count(TARBALL_URL), 0, "nothing is downloaded");
    assert_nothing_installed(&fixture);
    assert_eq!(fixture.events.stages().last(), Some(&PluginInstallStage::Failed));
    let details = error.details().unwrap();
    assert_eq!(details["minVersion"], "0.3.0");
    assert_eq!(details["appVersion"], APP_VERSION);
}

#[tokio::test]
async fn the_same_plugin_installs_once_the_app_is_new_enough() {
    let fixture = Fixture::new();
    fixture.publish_needing_app("1.0.0", good_tarball(), "0.3.0".into());

    let installed = fixture.as_app_version("0.3.0").install(PLUGIN, &echo_catalog_permissions()).await.unwrap();

    assert_eq!(installed.version, "1.0.0");
    assert_eq!(installed.load_error, None);
}

#[tokio::test]
async fn a_minimum_this_app_cannot_read_counts_as_needing_a_newer_app() {
    let fixture = Fixture::new();
    fixture.publish_needing_app("1.0.0", good_tarball(), serde_json::json!({ "desktop": ">=0.9" }));
    let service = fixture.as_app_version("0.2.1");

    assert_eq!(service.catalog(true).await.unwrap().plugins[0].needs_newer_app, needed(None));
    let error = service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert_needs_newer_app(&error, None);
    assert!(error.to_string().contains("made for a newer version of Graphrt Desktop"), "{error}");
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn an_update_that_needs_a_newer_app_keeps_the_installed_version() {
    let fixture = installed_fixture().await;
    let service = fixture.as_app_version("0.2.1");
    let update = tarball(&files_with_version("1.1.0"), &[]);
    fixture.publish_needing_app("1.1.0", update, "0.3.0".into());

    let catalog = service.catalog(true).await.unwrap();
    assert!(catalog.plugins[0].update_available);
    assert_eq!(catalog.plugins[0].needs_newer_app, needed(Some("0.3.0")));

    let installed = service.snapshot().plugins.clone();
    let plan = plan_updates(&service.cached_catalog().unwrap(), &installed, "0.2.1");
    assert_eq!(plan, Default::default(), "automatic updates and Update all leave it alone");
    assert_eq!(plan_updates(&service.cached_catalog().unwrap(), &installed, "0.3.0").ready.len(), 1);
    let summary = service.update_all_ready().await.unwrap();
    assert!(summary.updated.is_empty() && summary.failed.is_empty() && summary.needs_approval.is_empty());

    let error = service.update(PLUGIN).await.unwrap_err();
    assert_needs_newer_app(&error, Some("0.3.0"));
    assert_eq!(service.installed(PLUGIN).unwrap().version, "1.0.0");
    assert_eq!(service.installed(PLUGIN).unwrap().load_error, None);
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()], "no staging folder is left");
}

/// The fixture files with the manifest at `version`.
fn files_with_version(version: &str) -> Vec<(String, Vec<u8>)> {
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    files[0].1 = manifest.replace("\"version\": \"1.0.0\"", &format!("\"version\": \"{version}\"")).into_bytes();
    files
}

#[tokio::test]
async fn a_catalog_plugin_made_for_a_newer_app_says_so_instead_of_unknown_field() {
    // A catalog without min_app_version for it (an older catalog, or a saved copy).
    let fixture = Fixture::new();
    fixture.publish("1.0.0", tarball(&files_from_a_newer_app(), &[]));

    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert!(
        matches!(&error, AppError::NeedsNewerApp { min_version: None, unknown_feature: Some(feature) } if feature == "holograms"),
        "{error:?}"
    );
    let message = error.to_string();
    assert!(message.starts_with("This plugin was made for a newer version of Graphrt Desktop."), "{message}");
    assert!(!message.contains("unknown field") && !message.contains("expected one of"), "{message}");
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn an_archive_or_folder_made_for_a_newer_app_says_so_and_leaves_nothing_behind() {
    let fixture = Fixture::new();
    crate::desktop::app_settings::AppSettings { developer_mode: true, ..Default::default() }.save(&fixture.db).unwrap();
    let picked = tempfile::tempdir().unwrap();
    let archive = picked.path().join("fixture-echo-9.0.0.tar.gz");
    std::fs::write(&archive, tarball(&files_from_a_newer_app(), &[])).unwrap();
    let folder = picked.path().join("checkout");
    std::fs::create_dir_all(&folder).unwrap();
    for (path, contents) in files_from_a_newer_app() {
        std::fs::write(folder.join(path.strip_prefix(&format!("{PLUGIN}/")).unwrap()), contents).unwrap();
    }

    for picked_path in [&archive, &folder] {
        let error = fixture.service.install_local(&picked_path.to_string_lossy(), false).await.unwrap_err();
        assert!(
            matches!(&error, AppError::NeedsNewerApp { min_version: None, unknown_feature: Some(feature) } if feature == "holograms"),
            "{}: {error:?}",
            picked_path.display()
        );
        assert!(error.to_string().contains("It uses `holograms`, which this version does not know."), "{error}");
        assert_eq!(error.details().unwrap()["unknownFeature"], "holograms");
        assert_nothing_installed(&fixture);
    }
}

#[tokio::test]
async fn other_plugins_stay_installed_and_usable_when_one_needs_a_newer_app() {
    let fixture = installed_fixture().await;
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json_with_extras("1.0.0", TARBALL_URL, &"a".repeat(64), 10)).unwrap();
    catalog["plugins"][1]["min_app_version"] = "99.0.0".into();
    fixture.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());

    let view = fixture.service.catalog(true).await.unwrap();

    assert_eq!(view.plugins.len(), 3);
    assert_eq!(view.plugins[0].needs_newer_app, None);
    assert_eq!(view.plugins[0].installed_version.as_deref(), Some("1.0.0"));
    assert_eq!(view.plugins[1].needs_newer_app, needed(Some("99.0.0")));
    assert_eq!(view.plugins[2].needs_newer_app, None);
    let error = fixture.service.install(&view.plugins[1].name, &view.plugins[1].permissions).await.unwrap_err();
    assert_needs_newer_app(&error, Some("99.0.0"));
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().load_error, None);
}
