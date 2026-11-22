//! Catalog signatures: every index must verify against a trusted minisign key before it is
//! parsed; saved copies are verified again when read; a failed v2 never leads to an
//! unsigned v1. Fixture catalogs are signed with a throwaway test key (see `tests.rs`).

use super::*;

const V2_URL: &str = "https://plugins.example.test/index-v2.json";

fn signature_url(url: &str) -> String {
    format!("{url}.minisig")
}

/// The fixture v1 catalog document, as `schema: 2` (an index-v2.json without detail files).
fn v2_index_bytes(description: &str) -> Vec<u8> {
    let tarball = good_tarball();
    let sha = super::super::archive::sha256_hex(&tarball);
    let mut index: serde_json::Value =
        serde_json::from_slice(&catalog_json("1.0.0", TARBALL_URL, &sha, tarball.len())).unwrap();
    index["schema"] = 2.into();
    index["plugins"][0]["description"] = description.into();
    serde_json::to_vec(&index).unwrap()
}

fn assert_signature_error(error: &AppError) {
    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("signature")), "{error}");
}

#[tokio::test]
async fn a_validly_signed_catalog_is_used_and_saved_with_its_signature() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());

    let catalog = fixture.service.catalog(true).await.unwrap();

    assert!(!catalog.from_cache);
    assert_eq!(catalog.fetch_error, None);
    assert_eq!(catalog.plugins.len(), 1);
    let saved = fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME);
    assert!(saved.is_file());
    assert!(PathBuf::from(format!("{}.minisig", saved.display())).is_file());
}

#[tokio::test]
async fn a_tampered_catalog_is_refused_before_it_is_parsed() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    let mut tampered = fixture.downloader.files.lock().unwrap()[CATALOG_URL].clone();
    let position = tampered.windows(5).position(|window| window == b"Echoe").unwrap();
    tampered[position] = b'X';
    fixture.downloader.serve_raw(CATALOG_URL, tampered);

    let error = fixture.service.catalog(true).await.unwrap_err();

    assert_signature_error(&error);
    assert!(!fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME).exists(), "nothing is saved");
}

#[tokio::test]
async fn a_catalog_signed_with_another_key_is_refused() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    let other_key_pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let bytes = fixture.downloader.files.lock().unwrap()[CATALOG_URL].clone();
    fixture.downloader.serve_raw(&signature_url(CATALOG_URL), minisign_signature(&other_key_pair, &bytes));

    let error = fixture.service.catalog(true).await.unwrap_err();

    assert_signature_error(&error);
}

#[tokio::test]
async fn an_unsigned_catalog_is_refused() {
    const { assert!(super::super::catalog_signature::REQUIRE_CATALOG_SIGNATURE, "no grace mode") };
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.downloader.files.lock().unwrap().remove(&signature_url(CATALOG_URL));

    let error = fixture.service.catalog(true).await.unwrap_err();

    assert_signature_error(&error);
    assert!(matches!(
        fixture.service.install(PLUGIN, &echo_catalog_permissions()).await,
        Err(AppError::InvalidInput(_))
    ));
    assert!(fixture.plugin_folder_entries().is_empty());
}

#[tokio::test]
async fn an_oversized_signature_is_refused() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    let size = usize::try_from(super::super::catalog_signature::MAX_SIGNATURE_BYTES).unwrap() + 1;
    fixture.downloader.serve_raw(&signature_url(CATALOG_URL), vec![b'a'; size]);

    assert_signature_error(&fixture.service.catalog(true).await.unwrap_err());
}

#[tokio::test]
async fn a_bad_signature_falls_back_to_the_saved_copy_and_says_why() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.downloader.files.lock().unwrap().remove(&signature_url(CATALOG_URL));

    let catalog = fixture.restarted().catalog(true).await.unwrap();

    assert!(catalog.from_cache);
    assert_eq!(catalog.plugins.len(), 1);
    assert!(catalog.fetch_error.as_deref().is_some_and(|message| message.contains("signature")), "{catalog:?}");
}

#[tokio::test]
async fn saved_copies_are_verified_again_when_read() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.service.catalog(true).await.unwrap();
    fixture.downloader.forget(CATALOG_URL);
    let saved = fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME);
    let saved_signature = PathBuf::from(format!("{}.minisig", saved.display()));
    assert!(fixture.restarted().catalog(false).await.unwrap().from_cache, "an untouched saved copy is used offline");

    let original = std::fs::read(&saved).unwrap();
    let tampered = String::from_utf8(original.clone()).unwrap().replace("Echoes", "Xchoes");
    std::fs::write(&saved, tampered).unwrap();
    assert!(fixture.restarted().catalog(false).await.is_err(), "a tampered saved copy is ignored");
    assert!(fixture.restarted().known_catalog().is_none());

    std::fs::write(&saved, &original).unwrap();
    std::fs::remove_file(&saved_signature).unwrap();
    assert!(fixture.restarted().catalog(false).await.is_err(), "a saved copy without its signature is ignored");
}

#[tokio::test]
async fn a_v2_with_a_bad_signature_never_leads_to_v1() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.downloader.serve(V2_URL, v2_index_bytes("from v2"));
    let other_key_pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let v2_bytes = fixture.downloader.files.lock().unwrap()[V2_URL].clone();
    fixture.downloader.serve_raw(&signature_url(V2_URL), minisign_signature(&other_key_pair, &v2_bytes));

    let error = fixture.service.catalog(true).await.unwrap_err();

    assert_signature_error(&error);
    assert_eq!(fixture.downloader.request_count(CATALOG_URL), 0, "even a signed v1 is not tried");
}

#[tokio::test]
async fn a_v2_without_signature_never_leads_to_v1() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.downloader.serve(V2_URL, v2_index_bytes("from v2"));
    fixture.downloader.files.lock().unwrap().remove(&signature_url(V2_URL));

    assert_signature_error(&fixture.service.catalog(true).await.unwrap_err());
    assert_eq!(fixture.downloader.request_count(CATALOG_URL), 0);
}

#[tokio::test]
async fn a_missing_v2_falls_back_only_to_a_signed_v1() {
    let fixture = Fixture::new();
    fixture.publish("1.0.0", good_tarball());
    fixture.downloader.files.lock().unwrap().remove(&signature_url(CATALOG_URL));

    let unsigned = fixture.service.catalog(true).await;

    assert_signature_error(&unsigned.unwrap_err());
    assert_eq!(fixture.downloader.request_count(V2_URL), 1);
    assert!(!fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME).exists());

    fixture.publish("1.0.0", good_tarball());
    assert_eq!(fixture.service.catalog(true).await.unwrap().plugins.len(), 1, "a signed v1 is fine");
}

#[tokio::test]
async fn a_signed_v2_is_saved_and_verified_again_offline() {
    let fixture = Fixture::new();
    fixture.downloader.serve(V2_URL, v2_index_bytes("from v2"));
    assert_eq!(fixture.service.catalog(true).await.unwrap().plugins[0].description, "from v2");
    fixture.downloader.forget(V2_URL);

    let offline = fixture.restarted().catalog(true).await.unwrap();

    assert!(offline.from_cache);
    assert_eq!(offline.plugins[0].description, "from v2");
    assert_eq!(fixture.downloader.request_count(CATALOG_URL), 0, "v1 is never used after v2");
}
