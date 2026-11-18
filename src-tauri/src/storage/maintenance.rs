//! Whole-database operations (Settings › Privacy and data).

use super::Database;
use crate::error::AppResult;

impl Database {
    /// Deletes every agent, version, run, run event, schedule and setting in
    /// one transaction. Tables are emptied children first, so this does not
    /// depend on `ON DELETE CASCADE`.
    ///
    /// @throws AppError::Database - when a table cannot be emptied (nothing is deleted then)
    pub fn delete_all_data(&self) -> AppResult<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "DELETE FROM run_events;
             DELETE FROM runs;
             DELETE FROM triggers;
             DELETE FROM agent_versions;
             DELETE FROM agents;
             DELETE FROM settings;",
        )?;
        transaction.commit()?;
        Ok(())
    }
}
