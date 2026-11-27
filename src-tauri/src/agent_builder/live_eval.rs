//! Measures how often the builder makes a working agent with a real local model.
//!
//! Not part of the normal test run (`#[ignore]`): it needs Ollama with the model pulled, or
//! with `GRAPHRT_EVAL_PROVIDER=openai` an `OPENAI_API_KEY`.
//!
//! ```sh
//! GRAPHRT_EVAL_OLLAMA=http://127.0.0.1:11434 GRAPHRT_EVAL_MODEL=llama3.2 GRAPHRT_EVAL_ATTEMPTS=10 \
//!   cargo test --manifest-path src-tauri/Cargo.toml live_eval -- --ignored --nocapture
//! ```
//!
//! For every request it builds an agent `GRAPHRT_EVAL_ATTEMPTS` times (default 2), then
//! runs each built agent once with sample inputs, approving every question. An attempt
//! counts as working when the run succeeds with an output that is not empty. Set
//! `GRAPHRT_EVAL_REQUESTS=0,3` to use only some requests and `GRAPHRT_EVAL_RUN=0` to skip
//! the runs.

use std::sync::Arc;
use std::time::{Duration, Instant};

use graphrt_llm::openai::{OpenAiConfig, OpenAiModel};
use serde_json::json;

use super::*;
use crate::engine::{RunEventPayload, RunEventSink, RunManager};
use crate::storage::models::{RunStatus, RunTrigger};

/// Jobs a business user would plausibly type first, all doable with a model alone or a public lookup.
const REQUESTS: &[&str] = &[
    "Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it",
    "Write a polite reply to a customer complaint that I paste in",
    "Translate the text I give into Indonesian and make it sound formal",
    "Take my meeting notes and turn them into a list of action items with owners",
    "Write three Instagram caption ideas for a product I describe",
];

const RUN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug)]
struct QuietSink;

impl RunEventSink for QuietSink {
    fn send(&self, _payload: RunEventPayload) {}
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}

/// Address of the Ollama to measure with. Required, so a run never lands on an Ollama
/// someone else is using by default.
fn ollama_base_url() -> String {
    std::env::var("GRAPHRT_EVAL_OLLAMA").expect("set GRAPHRT_EVAL_OLLAMA, e.g. http://127.0.0.1:11500")
}

/// Nothing listens here: with a cloud model, no step may reach a local Ollama.
const NO_OLLAMA: &str = "http://127.0.0.1:9";

/// The model to measure: a local Ollama model, or with `GRAPHRT_EVAL_PROVIDER=openai` an
/// OpenAI model whose key is read from `OPENAI_API_KEY` (kept in memory only).
struct EvalSetup {
    builder: BuilderModel,
    credentials: Arc<CredentialStore>,
    ollama_base_url: String,
}

fn eval_setup(model_name: &str) -> EvalSetup {
    let credentials = Arc::new(CredentialStore::in_memory());
    if env_or("GRAPHRT_EVAL_PROVIDER", "ollama") == "openai" {
        let api_key = std::env::var("OPENAI_API_KEY").expect("set OPENAI_API_KEY for GRAPHRT_EVAL_PROVIDER=openai");
        credentials.set_api_key(ModelProvider::Openai, api_key.trim()).unwrap();
        let registry =
            crate::credentials::build_model_registry(&credentials, &Database::open_in_memory().unwrap()).unwrap();
        let builder = BuilderModel {
            model: registry.get("openai").unwrap(),
            choice: ModelChoice { provider: ModelProvider::Openai, name: model_name.to_owned() },
            available_providers: vec!["openai".into()],
        };
        return EvalSetup { builder, credentials, ollama_base_url: NO_OLLAMA.to_owned() };
    }
    let base_url = ollama_base_url();
    let model = OpenAiModel::new(OpenAiConfig::new(format!("{base_url}/v1"), None)).unwrap();
    let builder = BuilderModel {
        model: Arc::new(model),
        choice: ModelChoice { provider: ModelProvider::Ollama, name: model_name.to_owned() },
        available_providers: vec!["ollama".into()],
    };
    EvalSetup { builder, credentials, ollama_base_url: base_url }
}

/// A plausible value for each start input, by its type.
fn sample_inputs(flow_yaml: &str) -> serde_json::Value {
    let mut inputs = serde_json::Map::new();
    let Ok(summary) = flow::summarize_flow(flow_yaml) else { return json!({}) };
    for input in summary.inputs {
        let value = match input.input_type.as_str() {
            "number" => json!(3),
            "checkbox" => json!(true),
            "select" => json!(input.options.first().cloned().unwrap_or_default()),
            "json" => json!({"text": "Jakarta"}),
            "paragraph" => json!(
                "Our order of 20 lunch boxes arrived two hours late and cold. Rina will call the customer by \
                 Friday and Budi will refund the delivery fee."
            ),
            _ => json!("Jakarta"),
        };
        inputs.insert(input.name, value);
    }
    serde_json::Value::Object(inputs)
}

/// Runs the agent to its end, approving every question with its first action.
async fn run_to_end(db: &Arc<Database>, runs: &RunManager, agent: &Agent) -> Result<serde_json::Value, String> {
    let inputs = sample_inputs(&agent.flow_yaml);
    let run = runs.start_run(&agent.id, RunTrigger::Test, inputs).await.map_err(|error| format!("start: {error}"))?;
    let started = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let current = db.get_run(&run.id).map_err(|error| error.to_string())?;
        match current.status {
            RunStatus::Running if started.elapsed() > RUN_TIMEOUT => return Err("run timed out".into()),
            RunStatus::Running => {}
            RunStatus::Succeeded => {
                let outputs = current.outputs.unwrap_or_default();
                let has_text = outputs.as_object().is_some_and(|map| {
                    map.values().any(|value| match value {
                        serde_json::Value::String(text) => !text.trim().is_empty(),
                        serde_json::Value::Null => false,
                        _ => true,
                    })
                });
                return if has_text { Ok(outputs) } else { Err(format!("empty outputs: {outputs}")) };
            }
            RunStatus::Failed | RunStatus::Aborted => {
                return Err(format!("run failed: {}", current.error_message.unwrap_or_default()));
            }
            RunStatus::Paused => {
                let review = crate::run_review::get_run_review(db, &run.id).map_err(|error| error.to_string())?;
                let mut answers = serde_json::Map::new();
                for question in &review.pending {
                    let answer = match question.tool_call.as_ref() {
                        Some(call) => json!({"approvals": {call.call_id.clone(): true}}),
                        None => {
                            let action = question.actions.first().map(|action| action.id.clone()).unwrap_or_default();
                            json!({"action": action, "values": {}})
                        }
                    };
                    answers.insert(question.resume_key.clone(), answer);
                }
                if answers.is_empty() {
                    return Err(format!("paused on something else: {:?}", review.other_pause_kinds));
                }
                runs.resume_run(&run.id, serde_json::Value::Object(answers))
                    .await
                    .map_err(|error| format!("resume: {error}"))?;
            }
        }
    }
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().chars().take(220).collect()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a running Ollama with the model pulled"]
async fn live_eval() {
    let model_name = env_or("GRAPHRT_EVAL_MODEL", "llama3.2");
    let attempts: usize = env_or("GRAPHRT_EVAL_ATTEMPTS", "2").parse().unwrap();
    let with_runs = env_or("GRAPHRT_EVAL_RUN", "1") != "0";
    let chosen: Vec<usize> = match std::env::var("GRAPHRT_EVAL_REQUESTS") {
        Ok(list) => list.split(',').map(|index| index.trim().parse().unwrap()).collect(),
        Err(_) => (0..REQUESTS.len()).collect(),
    };
    let EvalSetup { builder, credentials, ollama_base_url } = eval_setup(&model_name);
    let (mut total, mut built, mut worked) = (0, 0, 0);
    for index in chosen {
        let description = REQUESTS[index];
        let (mut request_built, mut request_worked) = (0, 0);
        for attempt in 1..=attempts {
            total += 1;
            let db = Arc::new(Database::open_in_memory().unwrap());
            // Runs read the Ollama address from the app's settings.
            db.set_setting(crate::credentials::SETTING_OLLAMA_BASE_URL, &ollama_base_url).unwrap();
            let started = Instant::now();
            let request = BuildRequest { description: description.into(), kind: None };
            let agent = match build_agent_with_model(&db, &builder, request, &|_| {}).await {
                Ok(agent) => agent,
                Err(error) => {
                    let seconds = started.elapsed().as_secs();
                    println!(
                        "[{model_name}] r{index} a{attempt} BUILD-FAIL {seconds}s {}",
                        first_line(&error.to_string())
                    );
                    continue;
                }
            };
            built += 1;
            request_built += 1;
            let build_seconds = started.elapsed().as_secs();
            if std::env::var("GRAPHRT_EVAL_SHOW").is_ok() {
                println!("{}", agent.flow_yaml);
            }
            if !with_runs {
                println!("[{model_name}] r{index} a{attempt} BUILT {build_seconds}s");
                continue;
            }
            // The user's click on "Trust <host> for lookups".
            let lookups = flow::find_unapproved_steps(&agent.flow_yaml, &TrustedHosts::none()).unwrap_or_default();
            for host in lookups.iter().filter_map(|step| step.trustable_host.as_ref()) {
                db.add_trusted_lookup_host(&agent.id, host).unwrap();
            }
            let runs = RunManager::new(db.clone(), credentials.clone(), Arc::new(QuietSink));
            match run_to_end(&db, &runs, &agent).await {
                Ok(outputs) => {
                    worked += 1;
                    request_worked += 1;
                    println!(
                        "[{model_name}] r{index} a{attempt} WORKED build {build_seconds}s: {}",
                        first_line(&outputs.to_string())
                    );
                }
                Err(problem) => {
                    println!(
                        "[{model_name}] r{index} a{attempt} RUN-FAIL build {build_seconds}s: {}",
                        first_line(&problem)
                    )
                }
            }
        }
        println!("[{model_name}] r{index} built {request_built}/{attempts} worked {request_worked}/{attempts}: {description}");
    }
    println!("[{model_name}] TOTAL built {built}/{total} worked {worked}/{total}");
}
