//! Installing and trusting only what the user approved: the permissions shown on the
//! install / requirement card are the limit for the downloaded manifest, and trusting
//! refuses a plugin whose installed manifest asks for more than what was approved.

use super::*;
use crate::plugins::models::PluginPermissions;

const ECHO_FLOW: &str = "version: \"1\"\nname: echo\ngraph:\n  nodes:\n    - { id: start, type: start }\n    \
                         - { id: say, type: fixture-echo.echo, title: Say it, text: hi }\n  edges:\n    \
                         - { source: start, target: say }\n";

/// An index entry that lists less than the tarball's manifest asks for.
fn understated_permissions() -> PluginPermissions {
    PluginPermissions { network: false, secrets: false, env: Vec::new() }
}

impl Fixture {
    /// Serves the good tarball with a catalog entry that lists no secrets and no settings.
    fn publish_understated_index(&self) {
        let tarball = good_tarball();
        let sha = super::super::archive::sha256_hex(&tarball);
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
        catalog["plugins"][0]["permissions"] = serde_json::json!({ "network": false, "secrets": false, "env": [] });
        self.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
        self.downloader.serve(TARBALL_URL, tarball);
    }
}

fn trusted_names(fixture: &Fixture) -> Vec<String> {
    super::super::settings::trusted_plugins(&fixture.db).unwrap().into_iter().collect()
}

#[tokio::test]
async fn an_index_listing_less_than_the_tarball_manifest_is_refused_and_nothing_is_trusted() {
    let fixture = Fixture::new();
    fixture.publish_understated_index();
    fixture.service.catalog(true).await.unwrap();
    // The builder's requirement card shows the index's permissions; "Approve" passes exactly those.
    let requirement = fixture.service.requirements(ECHO_FLOW).unwrap().remove(0);
    let shown = PluginPermissions {
        network: requirement.permissions.network,
        secrets: requirement.permissions.secrets,
        env: requirement.permissions.env,
    };
    assert_eq!(shown, understated_permissions());

    let install = fixture.service.install(PLUGIN, &shown).await;
    let trust = fixture.service.set_trusted(PLUGIN, true, Some(&shown)).await;

    let error = install.unwrap_err();
    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("more than you approved")), "{error}");
    assert!(matches!(trust, Err(AppError::NotFound(_))), "nothing was installed to trust");
    assert_nothing_installed(&fixture);
    assert!(trusted_names(&fixture).is_empty());
}

#[tokio::test]
async fn installing_with_the_approved_permissions_works_and_starts_untrusted() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());

    let installed = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();

    assert_eq!(installed.permissions, echo_catalog_permissions());
    assert!(!installed.trusted);
}

#[tokio::test]
async fn trusting_refuses_an_installed_manifest_asking_for_more_than_approved() {
    let fixture = installed_fixture().await;

    let understated = fixture.service.set_trusted(PLUGIN, true, Some(&understated_permissions())).await;
    let unapproved = fixture.service.set_trusted(PLUGIN, true, None).await;

    let error = understated.unwrap_err();
    assert!(
        matches!(&error, AppError::InvalidInput(message) if message.contains("FIXTURE_ECHO_TOKEN") && message.contains("secrets")),
        "{error}"
    );
    assert!(matches!(unapproved, Err(AppError::InvalidInput(_))));
    assert!(!fixture.service.installed(PLUGIN).unwrap().trusted);
    assert!(trusted_names(&fixture).is_empty());
}

#[tokio::test]
async fn trusting_with_the_permissions_shown_works_and_untrusting_needs_no_approval() {
    let fixture = installed_fixture().await;

    let trusted = fixture.service.set_trusted(PLUGIN, true, Some(&echo_catalog_permissions())).await.unwrap();
    let untrusted = fixture.service.set_trusted(PLUGIN, false, None).await.unwrap();

    assert!(trusted.trusted);
    assert!(!untrusted.trusted);
}

/// The fixture files with `from` replaced by `to` in the manifest.
fn files_with_manifest_change(from: &str, to: &str) -> Vec<(String, Vec<u8>)> {
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    assert!(manifest.contains(from));
    files[0].1 = manifest.replace(from, to).into_bytes();
    files
}

#[tokio::test]
async fn a_tarball_whose_manifest_version_differs_from_the_catalog_is_refused() {
    let fixture = Fixture::new();
    // The catalog says 1.0.1, the tarball's manifest still says 1.0.0.
    fixture.publish("1.0.1", good_tarball());

    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert!(
        matches!(&error, AppError::InvalidInput(message) if message.contains("1.0.1") && message.contains("1.0.0")),
        "{error}"
    );
    assert_nothing_installed(&fixture);
}

#[tokio::test]
async fn an_update_whose_manifest_version_differs_from_the_catalog_keeps_the_installed_version() {
    let fixture = installed_fixture().await;
    let files = files_with_manifest_change("\"version\": \"1.0.0\"", "\"version\": \"1.0.5\"");
    fixture.publish("1.1.0", tarball(&files, &[]));
    fixture.service.catalog(true).await.unwrap();

    let error = fixture.service.update(PLUGIN).await.unwrap_err();

    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("1.0.5")), "{error}");
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");
}

#[tokio::test]
async fn a_tarball_whose_manifest_names_another_plugin_is_refused() {
    let fixture = Fixture::new();
    let files = files_with_manifest_change("\"name\": \"fixture-echo\"", "\"name\": \"other-echo\"");
    fixture.publish("1.0.0", tarball(&files, &[]));

    let error = fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap_err();

    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("other-echo")), "{error}");
    assert_nothing_installed(&fixture);
}
