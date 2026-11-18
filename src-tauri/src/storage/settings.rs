//! Small key/value app settings (default model, onboarding done, ...). Never secrets.

use super::Database;
use crate::error::{AppError, AppResult};

impl Database {
    pub fn get_setting(&self, _key: &str) -> AppResult<Option<String>> {
        Err(AppError::Internal("not implemented".into()))
    }

    pub fn set_setting(&self, _key: &str, _value: &str) -> AppResult<()> {
        Err(AppError::Internal("not implemented".into()))
    }
}
