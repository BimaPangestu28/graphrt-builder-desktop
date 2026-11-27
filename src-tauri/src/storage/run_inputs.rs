//! The workflow inputs each run started with (`run_inputs` table).
//!
//! graphrt does not record start inputs in its events or snapshots, so the
//! desktop keeps them next to the run: the test form (screen 06) is prefilled
//! from the agent's latest run, and "run it again" reuses a run's inputs.
//! A row is deleted with its run (`ON DELETE CASCADE`).

use rusqlite::{params, OptionalExtension};

use super::codec::{json_column, json_to_text};
use super::Database;
use crate::error::{AppError, AppResult};

impl Database {
    /// Stores the inputs a run started with, replacing any earlier value.
    ///
    /// # Errors
    /// - `InvalidInput` when `inputs` is not a JSON object.
    /// - `NotFound` when the run does not exist.
    pub fn save_run_inputs(&self, run_id: &str, inputs: &serde_json::Value) -> AppResult<()> {
        if !inputs.is_object() {
            return Err(AppError::InvalidInput("run inputs must be a JSON object".into()));
        }
        let connection = self.lock()?;
        let run_exists: bool =
            connection.query_row("SELECT EXISTS (SELECT 1 FROM runs WHERE id = ?1)", [run_id], |row| row.get(0))?;
        if !run_exists {
            return Err(AppError::NotFound(format!("run {run_id}")));
        }
        connection.execute(
            "INSERT INTO run_inputs (run_id, inputs_json) VALUES (?1, ?2)
             ON CONFLICT (run_id) DO UPDATE SET inputs_json = excluded.inputs_json",
            params![run_id, json_to_text(inputs)],
        )?;
        Ok(())
    }

    /// The inputs the run started with; `None` for runs recorded before inputs were kept.
    pub fn get_run_inputs(&self, run_id: &str) -> AppResult<Option<serde_json::Value>> {
        let connection = self.lock()?;
        let inputs = connection
            .query_row("SELECT inputs_json FROM run_inputs WHERE run_id = ?1", [run_id], |row| {
                json_column(row, "inputs_json")
            })
            .optional()?;
        Ok(inputs)
    }

    /// Inputs of the agent's most recently started run that has stored inputs.
    pub fn get_last_run_inputs(&self, agent_id: &str) -> AppResult<Option<serde_json::Value>> {
        Ok(self.get_last_run_inputs_with_version(agent_id)?.map(|(_, inputs)| inputs))
    }

    /// [`Database::get_last_run_inputs`] with the agent version that run used.
    pub fn get_last_run_inputs_with_version(&self, agent_id: &str) -> AppResult<Option<(i64, serde_json::Value)>> {
        let connection = self.lock()?;
        let inputs = connection
            .query_row(
                "SELECT runs.agent_version, run_inputs.inputs_json FROM run_inputs
                 JOIN runs ON runs.id = run_inputs.run_id
                 WHERE runs.agent_id = ?1
                 ORDER BY runs.started_at DESC, runs.rowid DESC
                 LIMIT 1",
                [agent_id],
                |row| Ok((row.get::<_, i64>(0)?, json_column(row, "inputs_json")?)),
            )
            .optional()?;
        Ok(inputs)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::RunTrigger;
    use crate::storage::test_support::{create_test_agent, test_database};

    #[test]
    fn stores_and_reads_a_runs_inputs() {
        let database = test_database();
        let agent = create_test_agent(&database, "Leads");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        assert_eq!(database.get_run_inputs(&run.id).unwrap(), None);

        database.save_run_inputs(&run.id, &json!({"city": "[CITY]"})).unwrap();
        assert_eq!(database.get_run_inputs(&run.id).unwrap(), Some(json!({"city": "[CITY]"})));
        database.save_run_inputs(&run.id, &json!({"city": "[OTHER CITY]"})).unwrap();
        assert_eq!(database.get_run_inputs(&run.id).unwrap(), Some(json!({"city": "[OTHER CITY]"})));
    }

    #[test]
    fn last_inputs_come_from_the_agents_newest_run() {
        let database = test_database();
        let agent = create_test_agent(&database, "Leads");
        let other_agent = create_test_agent(&database, "Digest");
        assert_eq!(database.get_last_run_inputs(&agent.id).unwrap(), None);

        let first_run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        database.save_run_inputs(&first_run.id, &json!({"keyword": "first"})).unwrap();
        let second_run = database.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        database.save_run_inputs(&second_run.id, &json!({"keyword": "second"})).unwrap();
        let other_run = database.insert_run(&other_agent.id, 1, RunTrigger::Test).unwrap();
        database.save_run_inputs(&other_run.id, &json!({"keyword": "other"})).unwrap();

        assert_eq!(database.get_last_run_inputs(&agent.id).unwrap(), Some(json!({"keyword": "second"})));
    }

    #[test]
    fn rejects_non_objects_and_unknown_runs() {
        let database = test_database();
        let agent = create_test_agent(&database, "Leads");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        assert!(matches!(database.save_run_inputs(&run.id, &json!([1])), Err(AppError::InvalidInput(_))));
        assert!(matches!(database.save_run_inputs("missing", &json!({})), Err(AppError::NotFound(_))));
    }
}
