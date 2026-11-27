//! Pairing codes: what the QR code on this computer holds.
//!
//! A code is not the phone's key. It is 256 random bits that work **once**, for
//! [`CODE_LIFETIME`]: the phone's pairing page trades it for a device token, and only
//! then does the device exist. A photo of an old QR code, or one that was never scanned,
//! opens nothing. Codes live in memory only (a restart ends them) and are kept as SHA-256
//! hashes. At most [`MAX_PENDING`] wait at a time.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// How long a code can be scanned.
pub const CODE_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// Codes waiting to be scanned at the same time; a new one ends the oldest.
const MAX_PENDING: usize = 5;
/// Codes start with this, so a code is never mistaken for a device token (`grd1.`).
const CODE_PREFIX: &str = "grp1.";

/// One code waiting to be scanned.
#[derive(Debug, Clone)]
struct PendingCode {
    id: String,
    hash: [u8; 32],
    device_name: String,
    expires: Instant,
}

/// A new code. `code` is shown once, as the QR code; only its hash is kept.
#[derive(Clone, PartialEq, Eq)]
pub struct NewCode {
    pub id: String,
    pub code: String,
}

impl std::fmt::Debug for NewCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("NewCode").field("id", &self.id).field("code", &"<redacted>").finish()
    }
}

/// The codes of this computer.
#[derive(Debug, Default)]
pub struct PairingCodes {
    pending: Mutex<Vec<PendingCode>>,
}

fn hash_code(code: &str) -> [u8; 32] {
    Sha256::digest(code.as_bytes()).into()
}

fn random_bytes<const N: usize>() -> AppResult<[u8; N]> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|error| AppError::Internal(format!("no system randomness: {error}")))?;
    Ok(bytes)
}

impl PairingCodes {
    /// A code that pairs a device named `device_name`.
    ///
    /// # Errors
    /// `Internal` when the system has no randomness.
    pub fn create(&self, device_name: &str) -> AppResult<NewCode> {
        self.create_at(device_name, Instant::now())
    }

    fn create_at(&self, device_name: &str, now: Instant) -> AppResult<NewCode> {
        let id = format!("pairing-{}", URL_SAFE_NO_PAD.encode(random_bytes::<9>()?));
        let code = format!("{CODE_PREFIX}{}", URL_SAFE_NO_PAD.encode(random_bytes::<32>()?));
        let mut pending = self.lock()?;
        pending.retain(|known| known.expires > now);
        while pending.len() >= MAX_PENDING {
            pending.remove(0);
        }
        pending.push(PendingCode {
            id: id.clone(),
            hash: hash_code(&code),
            device_name: device_name.to_owned(),
            expires: now + CODE_LIFETIME,
        });
        Ok(NewCode { id, code })
    }

    /// Uses `code` up: the device name it was made for, or `None` for a code that is
    /// unknown, used or expired.
    pub fn redeem(&self, code: &str) -> Option<String> {
        self.redeem_at(code, Instant::now())
    }

    fn redeem_at(&self, code: &str, now: Instant) -> Option<String> {
        if !code.starts_with(CODE_PREFIX) || code.len() > 100 {
            return None;
        }
        let hash = hash_code(code);
        let mut pending = self.lock().ok()?;
        pending.retain(|known| known.expires > now);
        let position = pending.iter().position(|known| known.hash == hash)?;
        Some(pending.remove(position).device_name)
    }

    /// Ends the code `id` before its time (the person hid it or paired another way).
    pub fn cancel(&self, id: &str) {
        if let Ok(mut pending) = self.lock() {
            pending.retain(|known| known.id != id);
        }
    }

    /// Ends every code (Phone access was turned off).
    pub fn clear(&self) {
        if let Ok(mut pending) = self.lock() {
            pending.clear();
        }
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Vec<PendingCode>>> {
        self.pending.lock().map_err(|_| AppError::Internal("pairing codes are unavailable".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_pairs_once() {
        let codes = PairingCodes::default();
        let new = codes.create("Ana's phone").unwrap();
        assert!(new.code.starts_with(CODE_PREFIX) && new.code.len() > 40);
        assert_eq!(codes.redeem(&new.code).as_deref(), Some("Ana's phone"));
        assert_eq!(codes.redeem(&new.code), None);
    }

    #[test]
    fn a_code_expires() {
        let codes = PairingCodes::default();
        let now = Instant::now();
        let new = codes.create_at("phone", now).unwrap();
        assert_eq!(codes.redeem_at(&new.code, now + CODE_LIFETIME + Duration::from_secs(1)), None);
    }

    #[test]
    fn unknown_cancelled_and_cleared_codes_pair_nothing() {
        let codes = PairingCodes::default();
        assert_eq!(codes.redeem("grp1.made-up"), None);
        assert_eq!(codes.redeem("grd1.dev-1.secret"), None);
        let cancelled = codes.create("one").unwrap();
        codes.cancel(&cancelled.id);
        assert_eq!(codes.redeem(&cancelled.code), None);
        let cleared = codes.create("two").unwrap();
        codes.clear();
        assert_eq!(codes.redeem(&cleared.code), None);
    }

    #[test]
    fn only_the_newest_codes_wait() {
        let codes = PairingCodes::default();
        let first = codes.create("first").unwrap();
        let rest: Vec<NewCode> =
            (0..MAX_PENDING).map(|index| codes.create(&format!("phone {index}")).unwrap()).collect();
        assert_eq!(codes.redeem(&first.code), None);
        assert_eq!(codes.redeem(&rest[0].code).as_deref(), Some("phone 0"));
    }

    #[test]
    fn the_code_is_not_in_debug_output() {
        let new = PairingCodes::default().create("phone").unwrap();
        assert!(!format!("{new:?}").contains(&new.code));
    }
}
