//! Phone access in a build without the `phone-access` feature: every command says so.

use std::sync::Arc;

use crate::deploy::phone::{DevicePairing, PairedDevice};
use crate::engine::RunManager;
use crate::error::{AppError, AppResult};

/// Untyped in this build: nothing is ever read or returned.
pub type PhoneAccessSettings = serde_json::Value;
pub type PhoneAccessStatus = serde_json::Value;
pub type Activity = serde_json::Value;

fn not_in_this_build() -> AppError {
    AppError::InvalidInput("this build of Graphrt Desktop has no Phone access".into())
}

/// Phone access that does nothing.
#[derive(Debug, Default)]
pub struct PhoneAccess;

impl PhoneAccess {
    pub fn attach(&self, _runs: Arc<RunManager>) {}

    pub fn spawn(self: &Arc<Self>) {}

    pub async fn status(&self) -> AppResult<PhoneAccessStatus> {
        Err(not_in_this_build())
    }

    pub async fn save(&self, _settings: PhoneAccessSettings) -> AppResult<PhoneAccessStatus> {
        Err(not_in_this_build())
    }

    pub fn list_devices(&self) -> AppResult<Vec<PairedDevice>> {
        Err(not_in_this_build())
    }

    pub async fn pair(&self, _name: &str) -> AppResult<DevicePairing> {
        Err(not_in_this_build())
    }

    pub fn revoke(&self, _device_id: &str) -> AppResult<()> {
        Err(not_in_this_build())
    }

    pub fn activity(&self, _limit: usize) -> AppResult<Vec<Activity>> {
        Err(not_in_this_build())
    }
}
