//! Plugin display names: the catalog's curated `display_name` (checked, never fatal to
//! the entry), the humanized fallback, and keeping the name on installed plugins offline.

use super::*;
use crate::plugins::catalog::{catalog_view, parse_catalog};

const DISPLAY_NAME: &str = "Fixture Echo Pro";

/// The fixture catalog (pointing at `tarball`) with `display_name` set on the echo plugin.
fn catalog_with_display_name(display_name: serde_json::Value, tarball: &[u8]) -> Vec<u8> {
    let sha = super::super::archive::sha256_hex(tarball);
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
    catalog["plugins"][0]["display_name"] = display_name;
    serde_json::to_vec(&catalog).unwrap()
}

/// A fixture serving the echo plugin with `display_name` in the catalog.
fn fixture_with_display_name(display_name: &str) -> Fixture {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    fixture.downloader.serve(CATALOG_URL, catalog_with_display_name(display_name.into(), &tarball));
    fixture.downloader.serve(TARBALL_URL, tarball);
    fixture
}

#[test]
fn a_curated_display_name_is_trimmed_and_shown_in_the_catalog() {
    let index = parse_catalog(&catalog_with_display_name("  Fixture Echo Pro ".into(), &good_tarball())).unwrap();
    assert_eq!(index.plugins[0].display_name.as_deref(), Some(DISPLAY_NAME));

    let view = catalog_view(&index, &[], Default::default());
    assert_eq!(view.plugins[0].display_name, DISPLAY_NAME);
    assert_eq!(view.plugins[0].name, PLUGIN, "the technical name stays the identifier");
}

#[test]
fn an_invalid_display_name_is_dropped_but_the_plugin_stays_listed() {
    let too_long = "A".repeat(61);
    let invalid_values: Vec<serde_json::Value> = vec![
        too_long.into(),
        "Echo\nPro".into(),
        "Echo\u{0}Pro".into(),
        "Tab\tbed".into(),
        "   ".into(),
        "".into(),
        42.into(),
        serde_json::json!({ "en": "Echo" }),
        serde_json::Value::Null,
    ];
    for invalid_value in invalid_values {
        let index = parse_catalog(&catalog_with_display_name(invalid_value.clone(), &good_tarball())).unwrap();
        assert_eq!(index.plugins.len(), 1, "{invalid_value}");
        assert_eq!(index.plugins[0].display_name, None, "{invalid_value}");
        let view = catalog_view(&index, &[], Default::default());
        assert_eq!(view.plugins[0].display_name, "Fixture Echo", "{invalid_value}");
    }
}

#[test]
fn a_display_name_of_exactly_sixty_characters_is_kept() {
    let sixty = "É".repeat(60);
    let index = parse_catalog(&catalog_with_display_name(sixty.clone().into(), &good_tarball())).unwrap();
    assert_eq!(index.plugins[0].display_name.as_deref(), Some(sixty.as_str()));
}

#[test]
fn catalogs_without_display_name_show_the_humanized_name() {
    let index = parse_catalog(&catalog_json("1.0.0", TARBALL_URL, &"a".repeat(64), 1)).unwrap();
    assert_eq!(index.plugins[0].display_name, None);
    assert_eq!(catalog_view(&index, &[], Default::default()).plugins[0].display_name, "Fixture Echo");
}

#[tokio::test]
async fn installed_plugins_keep_their_display_name_without_any_catalog() {
    let fixture = fixture_with_display_name(DISPLAY_NAME);
    let installed = fixture.service.install(PLUGIN).await.unwrap();
    assert_eq!(installed.display_name, DISPLAY_NAME);

    std::fs::remove_file(fixture.app_data.path().join("plugin-catalog.json")).unwrap();
    fixture.downloader.forget(CATALOG_URL);
    let restarted = fixture.restarted();
    assert!(restarted.catalog(true).await.is_err(), "no catalog anywhere");

    let listed = restarted.list_installed().unwrap();
    assert_eq!(listed[0].display_name, DISPLAY_NAME);
}

#[tokio::test]
async fn installed_plugins_pick_up_a_display_name_the_catalog_added_later() {
    let fixture = installed_fixture().await;
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().display_name, "Fixture Echo");

    fixture.downloader.serve(CATALOG_URL, catalog_with_display_name(DISPLAY_NAME.into(), &good_tarball()));
    fixture.service.catalog(true).await.unwrap();

    assert_eq!(fixture.service.installed(PLUGIN).unwrap().display_name, DISPLAY_NAME);
}

#[tokio::test]
async fn requirements_carry_the_display_name() {
    let fixture = fixture_with_display_name(DISPLAY_NAME);
    fixture.service.catalog(true).await.unwrap();
    let flow = r#"
version: "1"
name: echo-only
graph:
  nodes:
    - { id: start, type: start }
    - { id: echo, type: fixture-echo.echo, title: Echo, text: hi }
    - { id: end, type: end, outputs: [] }
  edges:
    - { source: start, target: echo }
    - { source: echo, target: end }
"#;
    let requirements = fixture.service.requirements(flow).unwrap();
    assert_eq!(requirements[0].name, PLUGIN);
    assert_eq!(requirements[0].display_name, DISPLAY_NAME);
}
