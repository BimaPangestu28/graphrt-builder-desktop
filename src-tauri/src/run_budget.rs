//! What one run spent against its agent's spending limit, for the Run result screen.
//!
//! Tokens are summed from the `usage` of steps that finished (helper agents' steps
//! included: they run in the same run under their own frame). The money is an estimate:
//! each step's tokens at the list price of its model (`engine::prices`), the model read from
//! the workflow the step belongs to (the agent's version of the run, or the helper agent's
//! current version for a step under a helper's frame). It is `None` when a paid model has no
//! price. Whether the limit was reached comes from graphrt: a `budget` progress event (the
//! last answer was given without tools) or a run that failed with `limit_exceeded`.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value as Json;

use crate::engine::spending::{self, SpendingLimit};
use crate::error::AppResult;
use crate::storage::models::Run;
use crate::storage::Database;

/// Container steps whose usage repeats their body's.
const CONTAINER_NODE_KINDS: &[&str] = &["iteration", "loop"];
/// Step kinds that call a model and name it in `model`.
const MODEL_NODE_KINDS: &[&str] = &["agent", "llm", "question-classifier", "parameter-extractor"];

/// Keep `src/api/runSummaryTypes.ts` in sync.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBudget {
    pub tokens_used: u64,
    /// In millionths of a dollar; `None` when a step used a paid model without a known price.
    pub estimated_cost_micros: Option<u64>,
    /// The agent's limit now (it applies to its next runs too).
    pub limit: SpendingLimit,
    /// graphrt stopped the run, or made its last answer without tools, at the limit.
    pub limit_reached: bool,
}

/// The budget of a stored run from its events.
///
/// # Errors
/// `Database` when the agent's flows or limit cannot be read.
pub fn run_budget(db: &Database, run: &Run, events: &[Json]) -> AppResult<RunBudget> {
    let limit = spending::load(db, &run.agent_id)?;
    let mut models = ModelsByFlow::new(db, run)?;
    let mut tokens_used = 0_u64;
    let mut cost_micros = Some(0_u64);
    let mut kinds: HashMap<String, String> = HashMap::new();
    let mut limit_reached = run.error_message.as_deref().is_some_and(is_budget_stop);
    let mut run_tokens = 0_u64;
    for event in events {
        let text = |name: &str| event.get(name).and_then(Json::as_str);
        match text("type") {
            Some("node_started") => {
                if let (Some(exec_id), Some(kind)) = (text("exec_id"), text("kind")) {
                    kinds.insert(exec_id.to_owned(), kind.to_owned());
                }
            }
            Some("node_progress") if text("name") == Some("budget") => {
                limit_reached |= event.pointer("/data/final_turn").and_then(Json::as_bool) == Some(true);
            }
            // `limit_exceeded` is also the step, depth and time limits: only the budget's own words count.
            Some("node_failed") if text("error_type") == Some("limit_exceeded") => {
                limit_reached |= text("error").is_some_and(is_budget_stop);
            }
            // The run's own total also counts steps that failed (a step stopped at the limit).
            Some("run_succeeded" | "run_failed") => {
                if let Some(usage) = event.get("usage").and_then(read_usage) {
                    run_tokens = run_tokens.max(billable(&usage));
                }
            }
            Some("node_succeeded") => {
                let kind = text("exec_id").and_then(|exec_id| kinds.get(exec_id)).map(String::as_str);
                if kind.is_some_and(|kind| CONTAINER_NODE_KINDS.contains(&kind)) {
                    continue;
                }
                let Some(usage) = event.get("usage").and_then(read_usage) else { continue };
                tokens_used = tokens_used.saturating_add(billable(&usage));
                let model = models.model_of(text("frame").unwrap_or_default(), text("node_id").unwrap_or_default());
                // A step that used tokens with a model nobody can name has an unknown cost.
                let step_cost = model.and_then(|(provider, name)| price_of(&provider, &name, &usage));
                cost_micros = cost_micros.zip(step_cost).map(|(total, cost)| total.saturating_add(cost));
            }
            _ => {}
        }
    }
    let tokens_used = tokens_used.max(run_tokens);
    Ok(RunBudget { tokens_used, estimated_cost_micros: cost_micros, limit, limit_reached })
}

/// The words graphrt's run budget stops a run with (`graphrt_core::budget`).
fn is_budget_stop(message: &str) -> bool {
    ["token budget of", "cost budget of", "token or cost budget is spent"].iter().any(|words| message.contains(words))
}

fn billable(usage: &graphrt_core::Usage) -> u64 {
    usage.total_tokens.max(usage.prompt_tokens.saturating_add(usage.completion_tokens))
}

fn read_usage(usage: &Json) -> Option<graphrt_core::Usage> {
    let number = |name: &str| usage.get(name).and_then(Json::as_u64).unwrap_or(0);
    let usage = graphrt_core::Usage {
        prompt_tokens: number("prompt_tokens"),
        completion_tokens: number("completion_tokens"),
        total_tokens: number("total_tokens"),
    };
    (usage.total_tokens > 0 || usage.prompt_tokens > 0 || usage.completion_tokens > 0).then_some(usage)
}

/// The cost of `usage` on `provider/name`: `Some(0)` for a model on this computer, `None`
/// for a paid model without a known price.
fn price_of(provider: &str, name: &str, usage: &graphrt_core::Usage) -> Option<u64> {
    if !crate::engine::prices::is_paid_provider(provider) {
        return Some(0);
    }
    let mut registry = graphrt_llm::ModelRegistry::new();
    crate::engine::prices::add_list_prices(&mut registry);
    registry.price(provider, name).map(|price| price.cost_micros(usage))
}

/// The model of each step, per workflow (the run's own, and each helper agent's).
struct ModelsByFlow<'a> {
    db: &'a Database,
    /// Workflow (`""` for the run's own, else the helper agent id) → step id → model.
    flows: HashMap<String, HashMap<String, (String, String)>>,
}

impl<'a> ModelsByFlow<'a> {
    fn new(db: &'a Database, run: &Run) -> AppResult<Self> {
        let agent = db.get_agent(&run.agent_id)?;
        let flow_yaml = crate::engine::flow_for_version(db, &agent, run.agent_version)?;
        let mut flows = HashMap::new();
        flows.insert(String::new(), step_models(&flow_yaml));
        Ok(Self { db, flows })
    }

    fn model_of(&mut self, frame: &str, node_id: &str) -> Option<(String, String)> {
        let workflow = helper_of_frame(frame).unwrap_or_default().to_owned();
        if !self.flows.contains_key(&workflow) {
            let models = match self.db.get_agent(&workflow) {
                Ok(helper) => step_models(&helper.flow_yaml),
                Err(error) => {
                    log::warn!("could not read helper agent {workflow} to price its steps: {error}");
                    HashMap::new()
                }
            };
            self.flows.insert(workflow.clone(), models);
        }
        self.flows.get(&workflow).and_then(|models| models.get(node_id)).cloned()
    }
}

/// The helper agent whose workflow a step of `frame` belongs to: the last segment of the
/// form `<step>.<agent id>[<n>]` (node ids never contain `.`, so a container segment
/// `<step>[<n>]` never matches).
pub(crate) fn helper_of_frame(frame: &str) -> Option<&str> {
    frame.split('/').rev().find_map(|segment| {
        let (_, rest) = segment.split_once('.')?;
        rest.rsplit_once('[').map(|(workflow, _)| workflow)
    })
}

fn step_models(flow_yaml: &str) -> HashMap<String, (String, String)> {
    let Ok(document) = serde_saphyr::from_str::<Json>(flow_yaml) else {
        log::warn!("could not read a workflow to price its steps");
        return HashMap::new();
    };
    let nodes = document
        .pointer("/graph/nodes")
        .or_else(|| document.pointer("/workflow/graph/nodes"))
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    nodes
        .iter()
        .filter(|node| node.get("type").and_then(Json::as_str).is_some_and(|kind| MODEL_NODE_KINDS.contains(&kind)))
        .filter_map(|node| {
            let model = node.get("model").or_else(|| node.pointer("/data/model"))?;
            Some((
                node.get("id")?.as_str()?.to_owned(),
                (model.get("provider")?.as_str()?.to_owned(), model.get("name")?.as_str()?.to_owned()),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent, RunStatus, RunTrigger};
    use serde_json::json;

    const LEAD: &str = r#"
version: "1"
name: lead
graph:
  nodes:
    - { id: start, type: start }
    - { id: assistant, type: agent, model: { provider: openai, name: gpt-4o-mini }, query: "hi" }
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [assistant, text] }] }
  edges:
    - { source: start, target: assistant }
    - { source: assistant, target: end }
"#;

    #[test]
    fn a_frame_names_the_helper_its_step_belongs_to() {
        assert_eq!(helper_of_frame(""), None);
        assert_eq!(helper_of_frame("review[2]"), None);
        assert_eq!(helper_of_frame("assistant.3f2a-b1[0]"), Some("3f2a-b1"));
        assert_eq!(helper_of_frame("outer[1]/assistant.abc[0]/inner[3]"), Some("abc"));
        assert_eq!(helper_of_frame("a.first[0]/b.second[1]"), Some("second"));
    }

    #[test]
    fn tokens_of_the_run_and_its_helper_are_counted_and_priced_by_their_own_model() {
        let db = Database::open_in_memory().unwrap();
        let helper_flow = LEAD.replace("gpt-4o-mini", "llama3.2").replace("provider: openai", "provider: ollama");
        let helper = db
            .create_agent(NewAgent {
                name: "Helper".into(),
                kind: AgentKind::Task,
                description: String::new(),
                flow_yaml: helper_flow,
            })
            .unwrap();
        let lead = db
            .create_agent(NewAgent {
                name: "Lead".into(),
                kind: AgentKind::Task,
                description: String::new(),
                flow_yaml: LEAD.into(),
            })
            .unwrap();
        spending::save(&db, &lead.id, SpendingLimit { max_total_tokens: Some(5_000), max_cost_micros: None }).unwrap();
        let run = db.insert_run(&lead.id, lead.current_version, RunTrigger::Test).unwrap();
        let helper_frame = format!("assistant.{}[0]", helper.id);
        let events = vec![
            json!({"type": "node_started", "frame": "", "node_id": "assistant", "exec_id": "e1", "kind": "agent"}),
            json!({"type": "node_started", "frame": helper_frame, "node_id": "assistant", "exec_id": "e2", "kind": "agent"}),
            json!({"type": "node_succeeded", "frame": helper_frame, "node_id": "assistant", "exec_id": "e2",
                   "usage": {"prompt_tokens": 500, "completion_tokens": 500, "total_tokens": 1000}}),
            json!({"type": "node_progress", "frame": "", "node_id": "assistant", "exec_id": "e1", "name": "budget", "data": {"iteration": 3, "final_turn": true}}),
            json!({"type": "node_succeeded", "frame": "", "node_id": "assistant", "exec_id": "e1",
                   "usage": {"prompt_tokens": 1000, "completion_tokens": 1000, "total_tokens": 2000}}),
        ];

        let budget = run_budget(&db, &run, &events).unwrap();

        assert_eq!(budget.tokens_used, 3_000);
        // gpt-4o-mini: 1 000 in and 1 000 out are 750 micro-dollars; the helper's local model is free.
        assert_eq!(budget.estimated_cost_micros, Some(750));
        assert_eq!(budget.limit.max_total_tokens, Some(5_000));
        assert!(budget.limit_reached);
    }

    #[test]
    fn a_paid_model_without_a_price_leaves_the_cost_unknown() {
        let db = Database::open_in_memory().unwrap();
        let flow_yaml = LEAD.replace("gpt-4o-mini", "gpt-9-imaginary");
        let lead = db
            .create_agent(NewAgent {
                name: "Lead".into(),
                kind: AgentKind::Task,
                description: String::new(),
                flow_yaml,
            })
            .unwrap();
        let mut run = db.insert_run(&lead.id, lead.current_version, RunTrigger::Test).unwrap();
        let events = vec![json!({"type": "node_succeeded", "frame": "", "node_id": "assistant", "exec_id": "e1",
                                 "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}})];
        let budget = run_budget(&db, &run, &events).unwrap();
        assert_eq!((budget.tokens_used, budget.estimated_cost_micros, budget.limit_reached), (20, None, false));

        run.status = RunStatus::Failed;
        run.error_message = Some("step limit exceeded".into());
        assert!(!run_budget(&db, &run, &[]).unwrap().limit_reached, "another limit is not the spending limit");
        run.error_message = Some("token budget of 20000 exceeded (20412 used)".into());
        assert!(run_budget(&db, &run, &[]).unwrap().limit_reached);
        let failed_run = vec![
            json!({"type": "node_failed", "frame": "", "node_id": "assistant", "exec_id": "e1", "error_type": "limit_exceeded", "error": "step limit exceeded"}),
            json!({"type": "run_failed", "error": "step limit exceeded", "error_type": "limit_exceeded", "usage": {"prompt_tokens": 9000, "completion_tokens": 1000, "total_tokens": 10000}}),
        ];
        run.error_message = None;
        let budget = run_budget(&db, &run, &failed_run).unwrap();
        assert_eq!(
            (budget.tokens_used, budget.limit_reached),
            (10_000, false),
            "the run's total counts the failed step"
        );
    }
}
