//! Sideloading (Developer mode): installing from a folder or `.tar.gz`, the same safety
//! rules as catalog installs, name collisions, and local plugins never being matched
//! against catalog updates. Also the catalog's source / publisher labels end to end.

use super::*;
use crate::desktop::app_settings::AppSettings;
use crate::plugins::auto_update::{plan_updates, AutoUpdateOutcome};
use crate::plugins::models::PluginSource;

const PICKED_FOLDER_NAME: &str = "my-echo-checkout";

impl Fixture {
    fn set_developer_mode(&self, enabled: bool) {
        AppSettings { developer_mode: enabled, ..AppSettings::default() }.save(&self.db).unwrap();
    }

    /// A fixture with Developer mode on and nothing installed.
    fn developer() -> Self {
        let fixture = Fixture::new();
        fixture.set_developer_mode(true);
        fixture
    }
}

/// The fixture plugin as a folder named [`PICKED_FOLDER_NAME`] (the name does not have to match).
fn plugin_folder(parent: &Path, version: &str) -> PathBuf {
    let folder = parent.join(PICKED_FOLDER_NAME);
    std::fs::create_dir_all(&folder).unwrap();
    for (path, contents) in files_at(version) {
        let file_name = path.strip_prefix(&format!("{PLUGIN}/")).unwrap();
        std::fs::write(folder.join(file_name), contents).unwrap();
    }
    folder
}

/// The fixture files with the manifest at `version`.
fn files_at(version: &str) -> Vec<(String, Vec<u8>)> {
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    files[0].1 = manifest.replace("\"version\": \"1.0.0\"", &format!("\"version\": \"{version}\"")).into_bytes();
    files
}

fn write_archive(parent: &Path, bytes: &[u8]) -> PathBuf {
    let path = parent.join("fixture-echo-1.0.0.tar.gz");
    std::fs::write(&path, bytes).unwrap();
    path
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn a_plugin_folder_installs_as_local_and_untrusted() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "1.0.0");
    std::fs::create_dir_all(folder.join(".git/objects")).unwrap();
    std::fs::write(folder.join(".git/HEAD"), "ref: refs/heads/main").unwrap();

    let installed = fixture.service.install_local(&path_text(&folder), false).await.unwrap();

    assert_eq!(installed.name, PLUGIN);
    assert_eq!(installed.version, "1.0.0");
    assert_eq!(installed.source, PluginSource::Local);
    assert_eq!(installed.local_path, Some(path_text(&folder)));
    assert!(!installed.trusted);
    assert_eq!(installed.load_error, None);
    assert_eq!((installed.publisher, installed.repository_url, installed.readme_url), (None, None, None));
    assert!(fixture.service.node_registry().contains("fixture-echo.echo"));
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()]);
    assert!(!fixture.plugins_dir().join(PLUGIN).join(".git").exists(), ".git is not copied");
    assert!(folder.join("plugin.mjs").exists(), "the picked folder is left alone");
    let record = super::super::settings::install_records(&fixture.db).unwrap().remove(PLUGIN).unwrap();
    assert!(record.is_local());
}

#[tokio::test]
async fn a_plugin_archive_installs_as_local() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let archive_path = write_archive(picked.path(), &good_tarball());

    let installed = fixture.service.install_local(&path_text(&archive_path), false).await.unwrap();

    assert_eq!((installed.name.as_str(), installed.source), (PLUGIN, PluginSource::Local));
    assert!(!installed.trusted);
    assert!(fixture.service.node_registry().contains("fixture-echo.send_text"));
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()]);
}

#[tokio::test]
async fn sideloading_is_refused_while_developer_mode_is_off() {
    let fixture = Fixture::new();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "1.0.0");

    let refused = fixture.service.install_local(&path_text(&folder), false).await;

    assert!(matches!(refused, Err(AppError::InvalidInput(message)) if message.contains("Developer mode")));
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn archives_with_traversal_absolute_paths_or_links_are_refused() {
    let unsafe_archives = [
        tarball(&fixture_files(), &[RawEntry::File { path: "fixture-echo/../../escaped.txt", contents: b"x" }]),
        tarball(&fixture_files(), &[RawEntry::File { path: "/tmp/graphrt-absolute.txt", contents: b"x" }]),
        tarball(&fixture_files(), &[RawEntry::Symlink { path: "fixture-echo/secrets", target: "/etc/passwd" }]),
        tarball(&fixture_files(), &[RawEntry::Symlink { path: "fixture-echo/up", target: "../../.." }]),
    ];
    for bytes in unsafe_archives {
        let fixture = Fixture::developer();
        let picked = tempfile::tempdir().unwrap();
        let archive_path = write_archive(picked.path(), &bytes);

        let refused = fixture.service.install_local(&path_text(&archive_path), false).await;

        assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
        assert_nothing_installed(&fixture);
        assert!(!picked.path().parent().unwrap().join("escaped.txt").exists());
    }
}

#[tokio::test]
async fn an_archive_whose_top_folder_is_not_a_plugin_name_is_refused() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let archive_path = write_archive(picked.path(), b"not a tarball");
    assert!(fixture.service.install_local(&path_text(&archive_path), false).await.is_err());

    let other_file = picked.path().join("plugin.zip");
    std::fs::write(&other_file, b"PK").unwrap();
    let refused = fixture.service.install_local(&path_text(&other_file), false).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
    assert!(matches!(fixture.service.install_local("relative/path", false).await, Err(AppError::InvalidInput(_))));
    assert_nothing_installed(&fixture);
}

#[cfg(unix)]
#[tokio::test]
async fn folders_with_links_are_refused_and_links_are_never_followed() {
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "do not copy").unwrap();
    for link_name in ["leak.txt", "nested/leak-dir"] {
        let fixture = Fixture::developer();
        let picked = tempfile::tempdir().unwrap();
        let folder = plugin_folder(picked.path(), "1.0.0");
        let link = folder.join(link_name);
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        let target =
            if link_name.ends_with("-dir") { outside.path().to_path_buf() } else { outside.path().join("secret.txt") };
        std::os::unix::fs::symlink(target, &link).unwrap();

        let refused = fixture.service.install_local(&path_text(&folder), false).await;

        assert!(matches!(&refused, Err(AppError::InvalidInput(message)) if message.contains("a link")), "{refused:?}");
        assert_nothing_installed(&fixture);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_linked_manifest_is_refused() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "1.0.0");
    let real_manifest = picked.path().join("real-manifest.json");
    std::fs::rename(folder.join("graphrt-plugin.json"), &real_manifest).unwrap();
    std::os::unix::fs::symlink(&real_manifest, folder.join("graphrt-plugin.json")).unwrap();

    assert!(matches!(fixture.service.install_local(&path_text(&folder), false).await, Err(AppError::InvalidInput(_))));
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn a_folder_inside_the_plugins_folder_is_refused() {
    let fixture = installed_fixture().await;
    fixture.set_developer_mode(true);
    let installed_folder = fixture.plugins_dir().join(PLUGIN);

    let refused = fixture.service.install_local(&path_text(&installed_folder), true).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
    let refused = fixture.service.install_local(&path_text(fixture.app_data.path()), true).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().source, PluginSource::Official);
}

#[tokio::test]
async fn a_folder_with_a_broken_checksum_is_refused_like_a_catalog_plugin() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "1.0.0");
    std::fs::write(folder.join("plugin.mjs"), "console.log('changed')").unwrap();

    let refused = fixture.service.install_local(&path_text(&folder), false).await;

    assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn a_name_installed_from_the_catalog_is_only_replaced_once_confirmed() {
    let fixture = installed_fixture().await;
    fixture.set_developer_mode(true);
    trust(&fixture.service, PLUGIN).await.unwrap();
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "catalog-token").await.unwrap();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "9.0.0");

    let refused = fixture.service.install_local(&path_text(&folder), false).await;

    assert!(matches!(refused, Err(AppError::Conflict(_))), "{refused:?}");
    let untouched = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!((untouched.version.as_str(), untouched.source), ("1.0.0", PluginSource::Official));
    assert!(untouched.trusted);
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()], "the staging copy is removed");

    let replaced = fixture.service.install_local(&path_text(&folder), true).await.unwrap();

    assert_eq!((replaced.version.as_str(), replaced.source), ("9.0.0", PluginSource::Local));
    assert!(!replaced.trusted, "the replacement starts untrusted");
    assert!(
        !fixture.credentials.has_plugin_config(PLUGIN, "FIXTURE_ECHO_TOKEN").unwrap(),
        "the catalog plugin's settings are dropped"
    );
    assert_eq!(replaced.readme_url, None, "the catalog README is not the local plugin's");
}

#[tokio::test]
async fn a_local_plugin_is_reinstalled_without_asking_and_starts_untrusted_again() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    let folder = plugin_folder(picked.path(), "1.0.0");
    fixture.service.install_local(&path_text(&folder), false).await.unwrap();
    trust(&fixture.service, PLUGIN).await.unwrap();
    plugin_folder(picked.path(), "1.0.1");

    let reinstalled = fixture.service.install_local(&path_text(&folder), false).await.unwrap();

    assert_eq!(reinstalled.version, "1.0.1");
    assert!(!reinstalled.trusted);
}

#[tokio::test]
async fn local_plugins_are_never_matched_against_catalog_updates() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    fixture.service.install_local(&path_text(&plugin_folder(picked.path(), "1.0.0")), false).await.unwrap();
    fixture.publish("2.0.0", tarball(&files_at("2.0.0"), &[]));

    let catalog = fixture.service.catalog(true).await.unwrap();
    let entry = catalog.plugins.iter().find(|entry| entry.name == PLUGIN).unwrap();
    assert!(!entry.update_available && entry.installed_version.is_none(), "{entry:?}");
    let index = fixture.service.cached_catalog().unwrap();
    assert_eq!(plan_updates(&index, &fixture.service.catalog_matched_plugins(), APP_VERSION), Default::default());
    assert!(fixture.service.update_all_ready().await.unwrap().updated.is_empty());

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, .. } = outcome else { panic!("{outcome:?}") };
    assert!(summary.updated.is_empty() && summary.needs_approval.is_empty() && summary.failed.is_empty());
    assert!(matches!(fixture.service.update(PLUGIN).await, Err(AppError::InvalidInput(_))));
    assert!(matches!(
        fixture.service.install(PLUGIN, &echo_catalog_permissions()).await,
        Err(AppError::InvalidInput(_))
    ));
    let still_local = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!((still_local.version.as_str(), still_local.source), ("1.0.0", PluginSource::Local));
    assert!(matches!(fixture.service.readme_url(PLUGIN), Err(AppError::NotFound(_))), "no catalog README");
    assert_eq!(fixture.downloader.request_count(TARBALL_URL), 0, "the catalog tarball is never fetched");
}

#[tokio::test]
async fn a_local_plugin_is_removed_normally() {
    let fixture = Fixture::developer();
    let picked = tempfile::tempdir().unwrap();
    fixture.service.install_local(&path_text(&plugin_folder(picked.path(), "1.0.0")), false).await.unwrap();

    fixture.service.remove(PLUGIN).await.unwrap();

    assert_nothing_installed(&fixture);
    assert!(super::super::settings::install_records(&fixture.db).unwrap().is_empty());
}

#[tokio::test]
async fn community_source_publisher_and_repository_reach_the_catalog_and_the_install() {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    let sha = super::super::archive::sha256_hex(&tarball);
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
    catalog["plugins"][0]["source"] = "community".into();
    catalog["plugins"][0]["publisher"] = "  Acme Inc. ".into();
    catalog["plugins"][0]["repository_url"] = "https://github.com/acme/fixture-echo".into();
    fixture.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
    fixture.downloader.serve(TARBALL_URL, tarball);

    let entry = fixture.service.catalog(true).await.unwrap().plugins.remove(0);
    assert_eq!(entry.source, PluginSource::Community);
    assert_eq!(entry.publisher.as_deref(), Some("Acme Inc."));
    assert_eq!(entry.repository_url.as_deref(), Some("https://github.com/acme/fixture-echo"));
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!((json["source"].as_str(), json["publisher"].as_str()), (Some("community"), Some("Acme Inc.")));

    let installed = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    assert_eq!(installed.source, PluginSource::Community);
    assert_eq!(installed.publisher.as_deref(), Some("Acme Inc."));
    assert_eq!(fixture.service.repository_url(PLUGIN).unwrap(), "https://github.com/acme/fixture-echo");
    let restarted = fixture.restarted();
    assert_eq!(restarted.installed(PLUGIN).unwrap().source, PluginSource::Community, "kept in the install record");
}

#[tokio::test]
async fn entries_without_source_are_official_and_bad_labels_only_lose_the_label() {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    let sha = super::super::archive::sha256_hex(&tarball);
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
    catalog["plugins"][0]["source"] = "local".into();
    catalog["plugins"][0]["publisher"] = "\u{7}".into();
    catalog["plugins"][0]["repository_url"] = "http://github.com/acme/fixture-echo".into();
    fixture.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());

    let plugins = fixture.service.catalog(true).await.unwrap().plugins;

    assert_eq!(plugins.len(), 1, "the entry stays listed");
    assert_eq!(
        (plugins[0].source, plugins[0].publisher.as_deref(), plugins[0].repository_url.as_deref()),
        (PluginSource::Official, None, None)
    );
    assert!(matches!(fixture.service.repository_url(PLUGIN), Err(AppError::NotFound(_))));
}
