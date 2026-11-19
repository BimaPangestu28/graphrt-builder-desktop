//! Secrets the user saved in the app (Connections > Advanced > Secrets > Add secret,
//! or a value filled in from the builder), with a note and when they were saved.
//!
//! The keychain cannot list its entries, so the names live in an index stored as
//! JSON under one app setting. Values only ever go to the [`CredentialStore`], the
//! same store a run reads `env.*` values from, so a saved secret is usable at once.
//! Nothing here logs or returns a value.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::{now_rfc3339, Database};

/// App setting holding the JSON index of saved secret names.
const SAVED_SECRETS_SETTING: &str = "workflow_secret_index";
/// Largest value accepted (room for a PEM private key or a service-account JSON).
pub const SECRET_VALUE_MAX_BYTES: usize = 16 * 1024;
const SECRET_NAME_MAX_LENGTH: usize = 64;
const SECRET_NOTE_MAX_CHARS: usize = 200;

/// Serializes read-modify-write of the index between concurrent commands.
static INDEX_LOCK: Mutex<()> = Mutex::new(());

/// What is remembered about one saved secret (never its value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSecretRecord {
    pub note: Option<String>,
    /// RFC 3339 time of the first save.
    pub created_at: String,
    /// RFC 3339 time of the latest save.
    pub updated_at: String,
}

/// A new secret from the "Add secret" form.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkflowSecret {
    pub name: String,
    pub value: String,
    pub note: Option<String>,
}

// Hand-written so a stray `{:?}` can never print the value.
impl std::fmt::Debug for NewWorkflowSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("NewWorkflowSecret").field("name", &self.name).finish_non_exhaustive()
    }
}

/// Every saved secret by name.
///
/// An unreadable index is logged and treated as empty, so the Secrets list and the
/// builder keep working (values in the keychain are untouched).
///
/// # Errors
/// `Database` when the setting cannot be read.
pub fn saved_secrets(db: &Database) -> AppResult<BTreeMap<String, SavedSecretRecord>> {
    let Some(index_json) = db.get_setting(SAVED_SECRETS_SETTING)? else {
        return Ok(BTreeMap::new());
    };
    Ok(serde_json::from_str(&index_json).unwrap_or_else(|error| {
        log::warn!("the saved secrets index is unreadable and is ignored: {error}");
        BTreeMap::new()
    }))
}

/// Saved secret names, sorted (for the builder prompt).
///
/// # Errors
/// `Database` when the setting cannot be read.
pub fn saved_secret_names(db: &Database) -> AppResult<Vec<String>> {
    Ok(saved_secrets(db)?.into_keys().collect())
}

/// Adds a secret the user named. Refuses a name that already has a value, so
/// Add never silently overwrites one (Replace does that).
///
/// # Errors
/// `InvalidInput` for a name that is not UPPER_SNAKE_CASE, an empty or too large value,
/// a too long note or a name already saved; `Credentials` / `Database` when storing fails.
pub fn add_workflow_secret(db: &Database, credentials: &CredentialStore, secret: NewWorkflowSecret) -> AppResult<()> {
    let name = secret.name.trim();
    validate_new_secret_name(name)?;
    let note = normalize_note(secret.note.as_deref())?;
    if credentials.has_workflow_secret(name)? {
        return Err(AppError::InvalidInput(format!(
            "a secret named {name} is already saved; use Replace to change its value"
        )));
    }
    log::info!("adding the secret {name}");
    store_value(credentials, name, &secret.value)?;
    record_save(db, name, Some(note))
}

/// Saves or replaces the value of `name` (Replace, or a value the builder asks for).
/// Keeps the note and creation time of a secret saved before.
///
/// # Errors
/// `InvalidInput` for a malformed name or an empty or too large value;
/// `Credentials` / `Database` when storing fails.
pub fn replace_workflow_secret(db: &Database, credentials: &CredentialStore, name: &str, value: &str) -> AppResult<()> {
    let name = name.trim();
    store_value(credentials, name, value)?;
    record_save(db, name, None)
}

/// Removes the value from the keychain and the name from the index; succeeds when
/// neither exists.
///
/// # Errors
/// `InvalidInput` for a malformed name; `Credentials` / `Database` when removing fails.
pub fn remove_workflow_secret(db: &Database, credentials: &CredentialStore, name: &str) -> AppResult<()> {
    let name = name.trim();
    credentials.delete_workflow_secret(name)?;
    let _guard = lock_index()?;
    let mut index = saved_secrets(db)?;
    if index.remove(name).is_some() {
        write_index(db, &index)?;
    }
    Ok(())
}

fn store_value(credentials: &CredentialStore, name: &str, value: &str) -> AppResult<()> {
    if value.len() > SECRET_VALUE_MAX_BYTES {
        return Err(AppError::InvalidInput(format!(
            "the value for {name} is too large (at most {} KB)",
            SECRET_VALUE_MAX_BYTES / 1024
        )));
    }
    credentials.set_workflow_secret(name, value)
}

/// Records a save of `name`; `note` is `Some` to set it (Add), `None` to keep it.
fn record_save(db: &Database, name: &str, note: Option<Option<String>>) -> AppResult<()> {
    let _guard = lock_index()?;
    let mut index = saved_secrets(db)?;
    let now = now_rfc3339();
    let record = index.entry(name.to_owned()).or_insert_with(|| SavedSecretRecord {
        note: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    });
    record.updated_at = now;
    if let Some(note) = note {
        record.note = note;
    }
    write_index(db, &index)
}

fn write_index(db: &Database, index: &BTreeMap<String, SavedSecretRecord>) -> AppResult<()> {
    db.set_setting(SAVED_SECRETS_SETTING, &serde_json::to_string(index)?)
}

fn lock_index() -> AppResult<std::sync::MutexGuard<'static, ()>> {
    INDEX_LOCK.lock().map_err(|_| AppError::Internal("the saved secrets index lock is poisoned".into()))
}

/// Names the user types follow environment-variable style: `MY_SERVER_TOKEN`.
fn validate_new_secret_name(name: &str) -> AppResult<()> {
    let is_valid = !name.is_empty()
        && name.len() <= SECRET_NAME_MAX_LENGTH
        && name.starts_with(|character: char| character.is_ascii_uppercase())
        && name
            .chars()
            .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_');
    if is_valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "secret names use capital letters, digits and underscores (like MY_SERVER_TOKEN), start with a \
             letter and are at most {SECRET_NAME_MAX_LENGTH} characters"
        )))
    }
}

fn normalize_note(note: Option<&str>) -> AppResult<Option<String>> {
    let note = note.map(str::trim).filter(|note| !note.is_empty());
    match note {
        Some(note) if note.chars().count() > SECRET_NOTE_MAX_CHARS => {
            Err(AppError::InvalidInput(format!("the note is too long (at most {SECRET_NOTE_MAX_CHARS} characters)")))
        }
        other => Ok(other.map(str::to_owned)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_secret(name: &str, value: &str, note: Option<&str>) -> NewWorkflowSecret {
        NewWorkflowSecret { name: name.into(), value: value.into(), note: note.map(str::to_owned) }
    }

    #[test]
    fn add_stores_the_value_in_the_credential_store_and_the_name_in_the_index() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        add_workflow_secret(&db, &credentials, new_secret("MY_SERVER_TOKEN", "s3cret", Some(" deploy box "))).unwrap();

        assert_eq!(credentials.read_workflow_secret("MY_SERVER_TOKEN").unwrap().as_deref(), Some("s3cret"));
        let index = saved_secrets(&db).unwrap();
        let record = &index["MY_SERVER_TOKEN"];
        assert_eq!(record.note.as_deref(), Some("deploy box"));
        assert_eq!(record.created_at, record.updated_at);
        assert_eq!(saved_secret_names(&db).unwrap(), ["MY_SERVER_TOKEN"]);
        let stored_index = db.get_setting(SAVED_SECRETS_SETTING).unwrap().unwrap();
        assert!(!stored_index.contains("s3cret"), "the index never holds values");
    }

    #[test]
    fn add_rejects_malformed_names_and_values() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        let too_long_name = "A".repeat(65);
        for bad_name in ["", "my_token", "1TOKEN", "_TOKEN", "MY-TOKEN", "MY TOKEN", too_long_name.as_str()] {
            let result = add_workflow_secret(&db, &credentials, new_secret(bad_name, "value", None));
            assert!(matches!(result, Err(AppError::InvalidInput(_))), "{bad_name:?} should be rejected");
        }
        assert!(add_workflow_secret(&db, &credentials, new_secret(&"A".repeat(64), "value", None)).is_ok());
        for bad_value in ["", "   ", &"x".repeat(SECRET_VALUE_MAX_BYTES + 1)] {
            let result = add_workflow_secret(&db, &credentials, new_secret("API_TOKEN", bad_value, None));
            assert!(matches!(result, Err(AppError::InvalidInput(_))));
        }
        let long_note = "n".repeat(SECRET_NOTE_MAX_CHARS + 1);
        let result = add_workflow_secret(&db, &credentials, new_secret("API_TOKEN", "value", Some(&long_note)));
        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert!(!credentials.has_workflow_secret("API_TOKEN").unwrap(), "nothing stored after a rejection");
        assert!(!format!("{:?}", new_secret("API_TOKEN", "hidden-value", None)).contains("hidden-value"));
    }

    #[test]
    fn add_refuses_to_overwrite_a_saved_value() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        add_workflow_secret(&db, &credentials, new_secret("DB_PASSWORD", "first", None)).unwrap();
        let result = add_workflow_secret(&db, &credentials, new_secret("DB_PASSWORD", "second", None));
        assert!(matches!(result, Err(AppError::InvalidInput(message)) if message.contains("Replace")));
        assert_eq!(credentials.read_workflow_secret("DB_PASSWORD").unwrap().as_deref(), Some("first"));
    }

    #[test]
    fn replace_keeps_the_note_and_creation_time() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        add_workflow_secret(&db, &credentials, new_secret("DB_PASSWORD", "first", Some("prod db"))).unwrap();
        let created_at = saved_secrets(&db).unwrap()["DB_PASSWORD"].created_at.clone();

        replace_workflow_secret(&db, &credentials, "DB_PASSWORD", "second").unwrap();

        assert_eq!(credentials.read_workflow_secret("DB_PASSWORD").unwrap().as_deref(), Some("second"));
        let record = &saved_secrets(&db).unwrap()["DB_PASSWORD"];
        assert_eq!(record.note.as_deref(), Some("prod db"));
        assert_eq!(record.created_at, created_at);
    }

    #[test]
    fn replace_records_a_secret_saved_from_the_builder() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        replace_workflow_secret(&db, &credentials, "maps_key", "value").unwrap();
        assert_eq!(saved_secret_names(&db).unwrap(), ["maps_key"], "agent-declared names keep their spelling");
    }

    #[test]
    fn remove_deletes_the_value_and_the_name() {
        let db = Database::open_in_memory().unwrap();
        let credentials = CredentialStore::in_memory();
        add_workflow_secret(&db, &credentials, new_secret("API_TOKEN", "value", None)).unwrap();
        remove_workflow_secret(&db, &credentials, "API_TOKEN").unwrap();
        assert!(!credentials.has_workflow_secret("API_TOKEN").unwrap());
        assert!(saved_secret_names(&db).unwrap().is_empty());
        remove_workflow_secret(&db, &credentials, "API_TOKEN").expect("removing again succeeds");
    }

    #[test]
    fn an_unreadable_index_counts_as_empty() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting(SAVED_SECRETS_SETTING, "not json").unwrap();
        assert!(saved_secrets(&db).unwrap().is_empty());
    }
}
