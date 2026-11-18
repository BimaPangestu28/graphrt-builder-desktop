//! Plugin state kept in the settings table: which plugins the user trusts and
//! what the app remembers about each install. Never setting values (those are
//! in the keychain, see `CredentialStore::set_plugin_config`).

use std::collections::{BTreeMap, BTreeSet};

use super::models::InstallRecord;
use crate::error::AppResult;
use crate::storage::Database;

/// JSON array of trusted plugin names.
const SETTING_TRUSTED_PLUGINS: &str = "plugins.trusted";
/// JSON object `name -> InstallRecord`.
const SETTING_INSTALL_RECORDS: &str = "plugins.installed";

/// Plugins the user trusts. A corrupt value is treated as "none trusted" (safe default).
pub(super) fn trusted_plugins(db: &Database) -> AppResult<BTreeSet<String>> {
    Ok(read_json(db, SETTING_TRUSTED_PLUGINS)?.unwrap_or_default())
}

/// Adds or removes `name` from the trusted list.
pub(super) fn set_trusted(db: &Database, name: &str, trusted: bool) -> AppResult<()> {
    let mut names = trusted_plugins(db)?;
    if trusted {
        names.insert(name.to_owned());
    } else {
        names.remove(name);
    }
    db.set_setting(SETTING_TRUSTED_PLUGINS, &serde_json::to_string(&names)?)
}

pub(super) fn install_records(db: &Database) -> AppResult<BTreeMap<String, InstallRecord>> {
    Ok(read_json(db, SETTING_INSTALL_RECORDS)?.unwrap_or_default())
}

pub(super) fn save_install_record(db: &Database, name: &str, record: Option<InstallRecord>) -> AppResult<()> {
    let mut records = install_records(db)?;
    match record {
        Some(record) => records.insert(name.to_owned(), record),
        None => records.remove(name),
    };
    db.set_setting(SETTING_INSTALL_RECORDS, &serde_json::to_string(&records)?)
}

fn read_json<T: serde::de::DeserializeOwned>(db: &Database, key: &str) -> AppResult<Option<T>> {
    let Some(text) = db.get_setting(key)? else { return Ok(None) };
    match serde_json::from_str(&text) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            log::warn!("ignoring the unreadable setting `{key}`: {error}");
            Ok(None)
        }
    }
}
