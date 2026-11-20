//! Plugin icons: `icon_url` parsing, the size-capped download, the on-disk cache
//! and what the UI gets when there is no icon.

use base64::Engine as _;

use super::*;
use crate::plugins::icons::{self, MAX_ICON_BYTES};

const ICON_URL: &str = "https://plugins.example.test/icons/fixture-echo.svg";
const OTHER_ICON_URL: &str = "https://plugins.example.test/icons/fixture-echo-v2.svg";
const ICON_SVG: &[u8] =
    br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>"#;

/// The fixture catalog with `icon_url` set on the echo plugin.
fn catalog_with_icon(icon_url: serde_json::Value) -> Vec<u8> {
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &"a".repeat(64), 1)).unwrap();
    catalog["plugins"][0]["icon_url"] = icon_url;
    serde_json::to_vec(&catalog).unwrap()
}

/// A fixture whose catalog (fetched this session) gives the echo plugin `icon_url`.
async fn fixture_with_icon_url(icon_url: &str) -> Fixture {
    let fixture = Fixture::new();
    fixture.downloader.serve(CATALOG_URL, catalog_with_icon(icon_url.into()));
    fixture.service.catalog(true).await.unwrap();
    fixture
}

fn decode_data_url(data_url: &str) -> Vec<u8> {
    let encoded = data_url.strip_prefix("data:image/svg+xml;base64,").expect("an SVG data URL");
    base64::engine::general_purpose::STANDARD.decode(encoded).unwrap()
}

fn saved_icons(fixture: &Fixture) -> Vec<String> {
    let icons_dir = fixture.app_data.path().join(icons::ICONS_DIR_NAME);
    let Ok(entries) = std::fs::read_dir(icons_dir) else { return Vec::new() };
    let mut names: Vec<String> =
        entries.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

#[test]
fn catalog_entries_carry_their_https_icon_url() {
    let index = super::super::catalog::parse_catalog(&catalog_with_icon(ICON_URL.into())).unwrap();
    assert_eq!(index.plugins[0].icon_url.as_deref(), Some(ICON_URL));

    let view = super::super::catalog::catalog_view(&index, &[], false);
    assert_eq!(view.plugins[0].icon_url.as_deref(), Some(ICON_URL));
}

#[test]
fn a_non_https_icon_url_is_dropped_but_the_plugin_stays_listed() {
    for bad_url in ["http://plugins.example.test/icon.svg", "file:///etc/passwd", "javascript:alert(1)", "not a url"] {
        let index = super::super::catalog::parse_catalog(&catalog_with_icon(bad_url.into())).unwrap();
        assert_eq!(index.plugins.len(), 1, "{bad_url}");
        assert_eq!(index.plugins[0].icon_url, None, "{bad_url}");
    }
}

#[test]
fn catalogs_without_icon_url_still_parse() {
    let index = super::super::catalog::parse_catalog(&catalog_json("1.0.0", TARBALL_URL, &"a".repeat(64), 1)).unwrap();
    assert_eq!(index.plugins[0].icon_url, None);
}

#[tokio::test]
async fn the_icon_is_downloaded_once_and_served_as_an_svg_data_url() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    fixture.downloader.serve(ICON_URL, ICON_SVG.to_vec());

    let data_url = fixture.service.icon_data_url(PLUGIN).await.unwrap().expect("an icon");

    assert_eq!(decode_data_url(&data_url), ICON_SVG);
    assert_eq!(saved_icons(&fixture).len(), 1);
    // Served from disk once saved: the download is gone and the icon is still there.
    fixture.downloader.forget(ICON_URL);
    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), Some(data_url));
}

#[tokio::test]
async fn icons_work_offline_after_a_restart() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    fixture.downloader.serve(ICON_URL, ICON_SVG.to_vec());
    let first = fixture.service.icon_data_url(PLUGIN).await.unwrap();
    fixture.downloader.forget(ICON_URL);
    fixture.downloader.forget(CATALOG_URL);

    // A restarted app with no network reads the icon URL from the saved catalog.
    let restarted = fixture.restarted();

    assert!(first.is_some());
    assert_eq!(restarted.icon_data_url(PLUGIN).await.unwrap(), first);
}

#[tokio::test]
async fn an_icon_over_the_size_cap_is_refused_and_not_saved() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    let mut oversized = b"<svg>".to_vec();
    oversized.resize(usize::try_from(MAX_ICON_BYTES).unwrap() + 1, b' ');
    fixture.downloader.serve(ICON_URL, oversized);

    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), None);
    assert!(saved_icons(&fixture).is_empty());
}

#[tokio::test]
async fn an_icon_at_the_size_cap_is_accepted() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    let mut largest = b"<svg>".to_vec();
    largest.resize(usize::try_from(MAX_ICON_BYTES).unwrap(), b' ');
    fixture.downloader.serve(ICON_URL, largest);

    assert!(fixture.service.icon_data_url(PLUGIN).await.unwrap().is_some());
}

#[tokio::test]
async fn a_download_that_is_not_an_svg_is_refused() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    fixture.downloader.serve(ICON_URL, b"<html><body>Not found</body></html>".to_vec());

    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), None);
    assert!(saved_icons(&fixture).is_empty());
}

#[tokio::test]
async fn a_failed_icon_is_not_retried_until_the_next_start() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), None);

    fixture.downloader.serve(ICON_URL, ICON_SVG.to_vec());

    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), None);
    assert!(fixture.restarted().icon_data_url(PLUGIN).await.unwrap().is_some());
}

#[tokio::test]
async fn a_new_icon_url_fetches_the_new_icon_and_drops_the_old_file() {
    let fixture = fixture_with_icon_url(ICON_URL).await;
    fixture.downloader.serve(ICON_URL, ICON_SVG.to_vec());
    fixture.service.icon_data_url(PLUGIN).await.unwrap();
    let new_svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>"#;
    fixture.downloader.serve(OTHER_ICON_URL, new_svg.to_vec());
    fixture.downloader.serve(CATALOG_URL, catalog_with_icon(OTHER_ICON_URL.into()));
    fixture.service.catalog(true).await.unwrap();

    let data_url = fixture.service.icon_data_url(PLUGIN).await.unwrap().expect("the new icon");

    assert_eq!(decode_data_url(&data_url), new_svg);
    let icons_dir = fixture.app_data.path().join(icons::ICONS_DIR_NAME);
    let expected = icons::cached_icon_path(&icons_dir, PLUGIN, OTHER_ICON_URL);
    assert_eq!(saved_icons(&fixture), vec![expected.file_name().unwrap().to_string_lossy().into_owned()]);
}

#[tokio::test]
async fn installed_plugins_keep_their_icon_without_any_catalog() {
    let fixture = Fixture::new();
    let tarball = good_tarball();
    let sha = super::super::archive::sha256_hex(&tarball);
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
    catalog["plugins"][0]["icon_url"] = ICON_URL.into();
    fixture.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
    fixture.downloader.serve(TARBALL_URL, tarball);
    fixture.downloader.serve(ICON_URL, ICON_SVG.to_vec());

    let installed = fixture.service.install(PLUGIN).await.unwrap();
    assert_eq!(installed.icon_url.as_deref(), Some(ICON_URL));
    let first = fixture.service.icon_data_url(PLUGIN).await.unwrap();
    std::fs::remove_file(fixture.app_data.path().join("plugin-catalog.json")).unwrap();
    fixture.downloader.forget(CATALOG_URL);
    fixture.downloader.forget(ICON_URL);

    assert!(first.is_some());
    assert_eq!(fixture.restarted().icon_data_url(PLUGIN).await.unwrap(), first);
}

#[tokio::test]
async fn plugins_without_an_icon_get_none() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();

    assert_eq!(fixture.service.icon_data_url(PLUGIN).await.unwrap(), None);
    assert_eq!(fixture.service.icon_data_url("not-in-the-catalog").await.unwrap(), None);
}

#[tokio::test]
async fn invalid_plugin_names_are_refused() {
    let fixture = Fixture::new();
    assert!(matches!(fixture.service.icon_data_url("../escape").await, Err(AppError::InvalidInput(_))));
}

#[test]
fn icon_cache_files_are_named_after_the_plugin_and_the_url() {
    let icons_dir = Path::new("/icons");
    let first = icons::cached_icon_path(icons_dir, PLUGIN, ICON_URL);
    let second = icons::cached_icon_path(icons_dir, PLUGIN, OTHER_ICON_URL);
    assert_ne!(first, second);
    assert!(first.file_name().unwrap().to_string_lossy().starts_with("fixture-echo-"));
    assert_eq!(first.extension().unwrap(), "svg");
}
