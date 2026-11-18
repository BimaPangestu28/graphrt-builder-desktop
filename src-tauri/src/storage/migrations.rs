//! Schema migrations, applied in order and tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::AppResult;

/// Applies every migration newer than the database's `user_version`.
pub fn apply(_connection: &Connection) -> AppResult<()> {
    // CONTRACT: implemented by the storage owner. Create the tables listed in storage/mod.rs.
    Ok(())
}
