//! Minisign signatures of the plugin catalog (`index-v2.json.minisig`, `index.json.minisig`,
//! published next to each index on the graphrt-plugins `catalog` release).
//!
//! - The trusted public keys are built in ([`TRUSTED_CATALOG_PUBLIC_KEYS`]): a list, so a
//!   key rotation can ship the old and the new key together. There is no setting or
//!   environment variable to change them; tests build the service with their own keys.
//! - After an index is downloaded, `<index url>.minisig` is downloaded (at most
//!   [`MAX_SIGNATURE_BYTES`]) and the index bytes must verify against one of the trusted
//!   keys **before** they are parsed. With [`REQUIRE_CATALOG_SIGNATURE`], a missing or
//!   invalid signature makes the index unusable: the saved copy is used instead.
//! - The saved copy keeps its signature next to it (`<saved file>.minisig`) and is verified
//!   again every time it is read from disk.
//! - Plugin details, icons and tarballs are covered by the sha256 values in the signed index.
//!
//! Only prehashed (`ED`) signatures are accepted, as made by current minisign.

use crate::error::{AppError, AppResult};

/// Base64 minisign public keys whose signatures make a catalog index trusted. Key ids are
/// in the comments (as `minisign -V` prints them).
pub(super) const TRUSTED_CATALOG_PUBLIC_KEYS: &[&str] = &[
    // CB1AEE339F05C2BD: graphrt-plugins catalog key (2026).
    "RWS9wgWfM+4ayykVUw9LH3DOjwa+g/JFaREz3FWd/U8GJaa6q4WrNd9c",
];

/// Whether an index without a valid signature is refused. `true`: there is no grace mode.
pub(super) const REQUIRE_CATALOG_SIGNATURE: bool = true;

/// Largest `.minisig` file accepted (a minisign signature is about 300 bytes).
pub(super) const MAX_SIGNATURE_BYTES: u64 = 4 * 1024;

/// Suffix of a signature file next to the file it signs.
pub(super) const SIGNATURE_SUFFIX: &str = ".minisig";

/// The public keys a catalog index may be signed with.
#[derive(Clone)]
pub(super) struct CatalogKeys {
    keys: Vec<minisign_verify::PublicKey>,
}

impl std::fmt::Debug for CatalogKeys {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("CatalogKeys").field("count", &self.keys.len()).finish()
    }
}

impl CatalogKeys {
    /// The built-in [`TRUSTED_CATALOG_PUBLIC_KEYS`].
    pub fn built_in() -> Self {
        Self::from_base64(TRUSTED_CATALOG_PUBLIC_KEYS)
    }

    /// Keys from base64 minisign public keys; one that does not decode is logged and left out.
    pub fn from_base64(encoded_keys: &[&str]) -> Self {
        let keys = encoded_keys
            .iter()
            .filter_map(|encoded| match minisign_verify::PublicKey::from_base64(encoded) {
                Ok(key) => Some(key),
                Err(error) => {
                    log::error!("ignoring an invalid catalog public key: {error}");
                    None
                }
            })
            .collect();
        Self { keys }
    }

    /// Checks `signature_text` (a `.minisig` file) signs `index_bytes` with one of the keys.
    ///
    /// # Errors
    /// `InvalidInput` naming why: unreadable signature, unknown key, or a signature that
    /// does not match the bytes (tampered index or wrong key).
    pub fn verify(&self, index_bytes: &[u8], signature_text: &str) -> AppResult<()> {
        let signature = minisign_verify::Signature::decode(signature_text)
            .map_err(|error| invalid(format!("the signature cannot be read ({error})")))?;
        let mut last_error = invalid("no trusted key signed it".into());
        for key in &self.keys {
            match key.verify(index_bytes, &signature, false) {
                Ok(()) => return Ok(()),
                Err(minisign_verify::Error::UnexpectedKeyId) => {}
                Err(error) => last_error = invalid(format!("the signature does not match ({error})")),
            }
        }
        Err(last_error)
    }
}

fn invalid(reason: String) -> AppError {
    AppError::InvalidInput(format!("the plugin catalog signature is not valid: {reason}"))
}

/// The URL (or path text) of the signature next to `signed`.
pub(super) fn signature_location(signed: &str) -> String {
    format!("{signed}{SIGNATURE_SUFFIX}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_key_decodes_with_its_published_key_id() {
        let keys = CatalogKeys::built_in();
        assert_eq!(keys.keys.len(), TRUSTED_CATALOG_PUBLIC_KEYS.len());
        // Key id CB1AEE339F05C2BD, stored little-endian after the 2 algorithm bytes.
        let raw =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, TRUSTED_CATALOG_PUBLIC_KEYS[0]).unwrap();
        let key_id: Vec<u8> = raw[2..10].iter().rev().copied().collect();
        assert_eq!(key_id, [0xCB, 0x1A, 0xEE, 0x33, 0x9F, 0x05, 0xC2, 0xBD]);
    }

    #[test]
    fn garbage_signatures_are_refused() {
        let error = CatalogKeys::built_in().verify(b"{}", "not a signature").unwrap_err();
        assert!(error.to_string().contains("signature is not valid"), "{error}");
    }
}
