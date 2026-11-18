//! Small key/value app settings (default model, onboarding done, ...). Never secrets.

use rusqlite::{params, OptionalExtension};

use super::Database;
use crate::error::{AppError, AppResult};

impl Database {
    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        validate_key(key)?;
        let connection = self.lock()?;
        let value =
            connection.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0)).optional()?;
        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        validate_key(key)?;
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

fn validate_key(key: &str) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::InvalidInput("setting key must not be empty".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_support::test_database;

    #[test]
    fn missing_setting_is_none() {
        let database = test_database();
        assert_eq!(database.get_setting("default_model").unwrap(), None);
    }

    #[test]
    fn set_setting_inserts_then_overwrites() {
        let database = test_database();
        database.set_setting("default_model", "openai/gpt").unwrap();
        assert_eq!(database.get_setting("default_model").unwrap().as_deref(), Some("openai/gpt"));
        database.set_setting("default_model", "anthropic/claude").unwrap();
        assert_eq!(database.get_setting("default_model").unwrap().as_deref(), Some("anthropic/claude"));
        database.set_setting("onboarding_done", "true").unwrap();
        assert_eq!(database.get_setting("onboarding_done").unwrap().as_deref(), Some("true"));
    }

    #[test]
    fn empty_key_is_rejected() {
        let database = test_database();
        assert!(matches!(database.set_setting(" ", "x"), Err(AppError::InvalidInput(_))));
        assert!(matches!(database.get_setting(""), Err(AppError::InvalidInput(_))));
    }
}
