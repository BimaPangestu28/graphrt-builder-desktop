//! PKCE (RFC 7636, S256 only) and the `state` value of a sign-in.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use super::OAuthError;

/// A PKCE code verifier: 32 random bytes, base64url (43 characters).
pub struct Verifier(String);

impl Verifier {
    /// # Errors
    /// `Storage` when the OS random source fails.
    pub fn generate() -> Result<Self, OAuthError> {
        Ok(Self(random_text()?))
    }

    #[cfg(test)]
    pub fn from_text(text: &str) -> Self {
        Self(text.to_owned())
    }

    /// The verifier sent with the code exchange.
    pub fn secret(&self) -> &str {
        &self.0
    }

    /// `BASE64URL(SHA256(verifier))`, sent with the authorization request.
    pub fn challenge(&self) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(self.0.as_bytes()))
    }
}

impl std::fmt::Debug for Verifier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Verifier(..)")
    }
}

/// A random `state` value that ties the callback to this sign-in.
///
/// # Errors
/// `Storage` when the OS random source fails.
pub fn random_state() -> Result<String, OAuthError> {
    random_text()
}

fn random_text() -> Result<String, OAuthError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| OAuthError::Storage(format!("no random source: {error}")))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
