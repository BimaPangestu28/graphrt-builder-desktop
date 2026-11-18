//! Chains of agents (screen 11): "when agent A finishes, start agent B".
//!
//! A chain is an ordered list of steps; each step names an agent and the link
//! INTO it: where each of its start inputs comes from (an output of the previous
//! step's agent, or a constant), when it runs (previous step succeeded, or
//! always) and what the chain does when this step's agent fails (stop, or carry
//! on to the next link). The first step's `inputs` may only hold constants; they
//! are the inputs used by "Test chain".
//!
//! Tables (see `migrations.rs`): `chains(id, name, status, created_at, updated_at)`
//! and `chain_steps(chain_id, position, agent_id, input_mapping_json, run_condition, on_failure)`.
//! Starting the runs is not storage's job; see `crate::chains`.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, Row, ToSql};
use serde::{Deserialize, Serialize};

use super::agents::ensure_agent_exists;
use super::codec::json_to_text;
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

/// Longest chain accepted; also bounds how many runs one chain execution can start.
pub const MAX_CHAIN_STEPS: usize = 20;

const CHAIN_COLUMNS: &str = "id, name, status, created_at, updated_at";

/// Whether finished runs start the next agents of the chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainStatus {
    Active,
    Paused,
}

/// When the link into a step starts its agent, judged on the previous agent's run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainRunCondition {
    /// Only when the previous agent's run succeeded.
    OnSuccess,
    /// Whether the previous agent's run succeeded or failed.
    Always,
}

/// What the chain does when this step's agent fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainFailurePolicy {
    /// The chain ends at this step.
    Stop,
    /// The next link is still evaluated (it starts when its condition is `Always`).
    Continue,
}

/// Where one start input of a step's agent comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ChainInputSource {
    /// An output key of the previous step's run (`run.outputs[output_key]`).
    Output { output_key: String },
    /// A fixed value.
    Constant { value: serde_json::Value },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainInputMapping {
    /// Name of the start input of this step's agent.
    pub input: String,
    pub source: ChainInputSource,
}

/// One agent of a chain plus the link that leads into it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainStep {
    pub agent_id: String,
    #[serde(default)]
    pub inputs: Vec<ChainInputMapping>,
    pub run_condition: ChainRunCondition,
    pub on_failure: ChainFailurePolicy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chain {
    pub id: String,
    pub name: String,
    pub status: ChainStatus,
    /// In run order; step 0 is the agent the chain starts with.
    pub steps: Vec<ChainStep>,
    pub created_at: String,
    pub updated_at: String,
}

/// Editable fields of a chain (create and update).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainDraft {
    pub name: String,
    pub steps: Vec<ChainStep>,
}

/// A step of an active chain that comes right after `agent_id`, found when that agent's run ends.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainSuccessor {
    pub chain_id: String,
    /// Position of the step whose agent just finished.
    pub finished_position: usize,
}

impl Database {
    /// Creates a paused chain (activating it is a separate, explicit action).
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or invalid steps, `NotFound` for an unknown agent.
    pub fn create_chain(&self, draft: ChainDraft) -> AppResult<Chain> {
        let name = validate_draft(&draft)?;
        let now = now_rfc3339();
        let chain_id = uuid::Uuid::new_v4().to_string();
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            &format!("INSERT INTO chains ({CHAIN_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5)"),
            params![chain_id, name, ChainStatus::Paused, now, now],
        )?;
        replace_steps(&transaction, &chain_id, &draft.steps)?;
        let chain = fetch_chain(&transaction, &chain_id)?;
        transaction.commit()?;
        Ok(chain)
    }

    pub fn get_chain(&self, chain_id: &str) -> AppResult<Chain> {
        let connection = self.lock()?;
        fetch_chain(&connection, chain_id)
    }

    /// Every chain, oldest first.
    pub fn list_chains(&self) -> AppResult<Vec<Chain>> {
        let connection = self.lock()?;
        let chain_ids: Vec<String> = {
            let mut statement = connection.prepare("SELECT id FROM chains ORDER BY created_at ASC, rowid ASC")?;
            let ids = statement.query_map([], |row| row.get(0))?.collect::<Result<Vec<_>, _>>()?;
            ids
        };
        chain_ids.iter().map(|chain_id| fetch_chain(&connection, chain_id)).collect()
    }

    /// Replaces the name and every step; the status is kept.
    ///
    /// # Errors
    /// Same as [`Database::create_chain`], plus `NotFound` for an unknown chain.
    pub fn update_chain(&self, chain_id: &str, draft: ChainDraft) -> AppResult<Chain> {
        let name = validate_draft(&draft)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let updated_rows = transaction.execute(
            "UPDATE chains SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_rfc3339(), chain_id],
        )?;
        if updated_rows == 0 {
            return Err(chain_not_found(chain_id));
        }
        replace_steps(&transaction, chain_id, &draft.steps)?;
        let chain = fetch_chain(&transaction, chain_id)?;
        transaction.commit()?;
        Ok(chain)
    }

    pub fn set_chain_status(&self, chain_id: &str, status: ChainStatus) -> AppResult<Chain> {
        let connection = self.lock()?;
        let updated_rows = connection.execute(
            "UPDATE chains SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_rfc3339(), chain_id],
        )?;
        if updated_rows == 0 {
            return Err(chain_not_found(chain_id));
        }
        fetch_chain(&connection, chain_id)
    }

    pub fn delete_chain(&self, chain_id: &str) -> AppResult<()> {
        let connection = self.lock()?;
        let deleted_rows = connection.execute("DELETE FROM chains WHERE id = ?1", [chain_id])?;
        if deleted_rows == 0 {
            return Err(chain_not_found(chain_id));
        }
        Ok(())
    }

    /// Steps of ACTIVE chains where `agent_id` is followed by another step.
    pub fn find_active_chain_successors(&self, agent_id: &str) -> AppResult<Vec<ChainSuccessor>> {
        let chains = self.list_chains()?;
        let successors = chains
            .into_iter()
            .filter(|chain| chain.status == ChainStatus::Active)
            .flat_map(|chain| {
                let last_position = chain.steps.len().saturating_sub(1);
                chain
                    .steps
                    .iter()
                    .enumerate()
                    .filter(|(position, step)| step.agent_id == agent_id && *position < last_position)
                    .map(|(position, _)| ChainSuccessor { chain_id: chain.id.clone(), finished_position: position })
                    .collect::<Vec<_>>()
            })
            .collect();
        Ok(successors)
    }
}

fn chain_not_found(chain_id: &str) -> AppError {
    AppError::NotFound(format!("chain {chain_id}"))
}

/// Checks the draft and returns the trimmed name.
fn validate_draft(draft: &ChainDraft) -> AppResult<String> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("give the chain a name".into()));
    }
    if draft.steps.len() > MAX_CHAIN_STEPS {
        return Err(AppError::InvalidInput(format!("a chain can have at most {MAX_CHAIN_STEPS} agents")));
    }
    for (position, step) in draft.steps.iter().enumerate() {
        let previous_step = position.checked_sub(1).and_then(|previous| draft.steps.get(previous));
        validate_step(position, step, previous_step)?;
    }
    Ok(name.to_owned())
}

fn validate_step(position: usize, step: &ChainStep, previous_step: Option<&ChainStep>) -> AppResult<()> {
    if previous_step.is_some_and(|previous| previous.agent_id == step.agent_id) {
        return Err(AppError::InvalidInput(format!("step {} would start the same agent again", position + 1)));
    }
    let mut seen_inputs = std::collections::HashSet::new();
    for mapping in &step.inputs {
        if mapping.input.trim().is_empty() {
            return Err(AppError::InvalidInput(format!("step {} maps an input without a name", position + 1)));
        }
        if !seen_inputs.insert(mapping.input.as_str()) {
            return Err(AppError::InvalidInput(format!("step {} maps `{}` twice", position + 1, mapping.input)));
        }
        if let ChainInputSource::Output { output_key } = &mapping.source {
            if position == 0 {
                return Err(AppError::InvalidInput(
                    "the first agent has no previous agent to read outputs from".into(),
                ));
            }
            if output_key.trim().is_empty() {
                return Err(AppError::InvalidInput(format!("step {} reads an output without a name", position + 1)));
            }
        }
    }
    Ok(())
}

fn replace_steps(connection: &Connection, chain_id: &str, steps: &[ChainStep]) -> AppResult<()> {
    connection.execute("DELETE FROM chain_steps WHERE chain_id = ?1", [chain_id])?;
    for (position, step) in steps.iter().enumerate() {
        ensure_agent_exists(connection, &step.agent_id)?;
        let inputs_json = serde_json::to_value(&step.inputs)?;
        connection.execute(
            "INSERT INTO chain_steps (chain_id, position, agent_id, input_mapping_json, run_condition, on_failure)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                chain_id,
                i64::try_from(position).unwrap_or(i64::MAX),
                step.agent_id,
                json_to_text(&inputs_json),
                step.run_condition,
                step.on_failure,
            ],
        )?;
    }
    Ok(())
}

fn fetch_chain(connection: &Connection, chain_id: &str) -> AppResult<Chain> {
    let chain_row = connection
        .query_row(&format!("SELECT {CHAIN_COLUMNS} FROM chains WHERE id = ?1"), [chain_id], |row| {
            Ok((
                row.get::<_, String>("id")?,
                row.get::<_, String>("name")?,
                row.get::<_, ChainStatus>("status")?,
                row.get::<_, String>("created_at")?,
                row.get::<_, String>("updated_at")?,
            ))
        })
        .optional()?
        .ok_or_else(|| chain_not_found(chain_id))?;
    let (id, name, status, created_at, updated_at) = chain_row;
    let mut statement = connection.prepare(
        "SELECT agent_id, input_mapping_json, run_condition, on_failure FROM chain_steps
         WHERE chain_id = ?1 ORDER BY position ASC",
    )?;
    let steps = statement.query_map([chain_id], map_step_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(Chain { id, name, status, steps, created_at, updated_at })
}

fn map_step_row(row: &Row<'_>) -> rusqlite::Result<ChainStep> {
    let inputs_text: String = row.get("input_mapping_json")?;
    let inputs = serde_json::from_str(&inputs_text).map_err(|parse_error| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(parse_error))
    })?;
    Ok(ChainStep {
        agent_id: row.get("agent_id")?,
        inputs,
        run_condition: row.get("run_condition")?,
        on_failure: row.get("on_failure")?,
    })
}

/// TEXT column conversions for the chain enums (their serde names).
macro_rules! chain_text_column {
    ($enum_type:ty { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl ToSql for $enum_type {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(match self {
                    $(<$enum_type>::$variant => $text),+
                }))
            }
        }

        impl FromSql for $enum_type {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(<$enum_type>::$variant),)+
                    unknown => Err(FromSqlError::Other(
                        format!("unknown {} value {unknown:?}", stringify!($enum_type)).into(),
                    )),
                }
            }
        }
    };
}

chain_text_column!(ChainStatus { Active => "active", Paused => "paused" });
chain_text_column!(ChainRunCondition { OnSuccess => "on_success", Always => "always" });
chain_text_column!(ChainFailurePolicy { Stop => "stop", Continue => "continue" });

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    fn step(agent_id: &str, inputs: Vec<ChainInputMapping>) -> ChainStep {
        ChainStep {
            agent_id: agent_id.into(),
            inputs,
            run_condition: ChainRunCondition::OnSuccess,
            on_failure: ChainFailurePolicy::Stop,
        }
    }

    fn output_mapping(input: &str, output_key: &str) -> ChainInputMapping {
        ChainInputMapping { input: input.into(), source: ChainInputSource::Output { output_key: output_key.into() } }
    }

    #[test]
    fn create_chain_is_paused_and_round_trips_steps() {
        let database = test_database();
        let first = create_test_agent(&database, "First");
        let second = create_test_agent(&database, "Second");
        let draft = ChainDraft {
            name: " Leads to recap ".into(),
            steps: vec![
                step(
                    &first.id,
                    vec![ChainInputMapping {
                        input: "city".into(),
                        source: ChainInputSource::Constant { value: json!("Bandar Lampung") },
                    }],
                ),
                step(&second.id, vec![output_mapping("leads", "places")]),
            ],
        };
        let chain = database.create_chain(draft.clone()).unwrap();
        assert_eq!(chain.name, "Leads to recap");
        assert_eq!(chain.status, ChainStatus::Paused);
        assert_eq!(chain.steps, draft.steps);
        assert_eq!(database.get_chain(&chain.id).unwrap(), chain);
        assert_eq!(database.list_chains().unwrap(), vec![chain]);
    }

    #[test]
    fn invalid_drafts_are_rejected() {
        let database = test_database();
        let agent = create_test_agent(&database, "Only");
        let other = create_test_agent(&database, "Other");
        let blank_name = ChainDraft { name: " ".into(), steps: vec![] };
        assert!(matches!(database.create_chain(blank_name), Err(AppError::InvalidInput(_))));
        let output_on_first =
            ChainDraft { name: "x".into(), steps: vec![step(&agent.id, vec![output_mapping("a", "b")])] };
        assert!(matches!(database.create_chain(output_on_first), Err(AppError::InvalidInput(_))));
        let repeated = ChainDraft { name: "x".into(), steps: vec![step(&agent.id, vec![]), step(&agent.id, vec![])] };
        assert!(matches!(database.create_chain(repeated), Err(AppError::InvalidInput(_))));
        let duplicate_input = ChainDraft {
            name: "x".into(),
            steps: vec![
                step(&agent.id, vec![]),
                step(&other.id, vec![output_mapping("a", "b"), output_mapping("a", "c")]),
            ],
        };
        assert!(matches!(database.create_chain(duplicate_input), Err(AppError::InvalidInput(_))));
        let unknown_agent = ChainDraft { name: "x".into(), steps: vec![step("ghost", vec![])] };
        assert!(matches!(database.create_chain(unknown_agent), Err(AppError::NotFound(_))));
        assert!(database.list_chains().unwrap().is_empty());
    }

    #[test]
    fn update_status_and_delete() {
        let database = test_database();
        let first = create_test_agent(&database, "First");
        let second = create_test_agent(&database, "Second");
        let chain =
            database.create_chain(ChainDraft { name: "Chain".into(), steps: vec![step(&first.id, vec![])] }).unwrap();
        let updated = database
            .update_chain(
                &chain.id,
                ChainDraft { name: "Renamed".into(), steps: vec![step(&first.id, vec![]), step(&second.id, vec![])] },
            )
            .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.steps.len(), 2);
        assert_eq!(database.set_chain_status(&chain.id, ChainStatus::Active).unwrap().status, ChainStatus::Active);
        assert_eq!(
            database.find_active_chain_successors(&first.id).unwrap(),
            vec![ChainSuccessor { chain_id: chain.id.clone(), finished_position: 0 }]
        );
        // The last agent of a chain has nothing after it.
        assert!(database.find_active_chain_successors(&second.id).unwrap().is_empty());
        database.set_chain_status(&chain.id, ChainStatus::Paused).unwrap();
        assert!(database.find_active_chain_successors(&first.id).unwrap().is_empty());
        database.delete_chain(&chain.id).unwrap();
        assert!(matches!(database.get_chain(&chain.id), Err(AppError::NotFound(_))));
        assert!(matches!(database.delete_chain(&chain.id), Err(AppError::NotFound(_))));
        assert!(matches!(database.set_chain_status("ghost", ChainStatus::Active), Err(AppError::NotFound(_))));
    }

    #[test]
    fn deleting_an_agent_removes_its_steps() {
        let database = test_database();
        let first = create_test_agent(&database, "First");
        let second = create_test_agent(&database, "Second");
        let chain = database
            .create_chain(ChainDraft {
                name: "Chain".into(),
                steps: vec![step(&first.id, vec![]), step(&second.id, vec![])],
            })
            .unwrap();
        database.delete_agent(&second.id).unwrap();
        assert_eq!(database.get_chain(&chain.id).unwrap().steps.len(), 1);
    }

    #[test]
    fn input_sources_serialize_with_a_kind_tag() {
        let mapping = output_mapping("leads", "places");
        assert_eq!(
            serde_json::to_value(&mapping).unwrap(),
            json!({"input": "leads", "source": {"kind": "output", "outputKey": "places"}})
        );
    }
}
