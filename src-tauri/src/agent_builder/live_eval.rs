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
//! the runs. `GRAPHRT_EVAL_FULL_DOCUMENT=1` builds on the full-document path only (the
//! number before the guided path existed).

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

const NOTES: &str = "Our order of 20 lunch boxes arrived two hours late and cold. Rina will call the customer by \
                     Friday and Budi will refund the delivery fee.";

/// Per request: what the person types into every text input.
const SAMPLE_TEXTS: &[&str] = &["Jakarta", NOTES, NOTES, NOTES, "Handmade leather wallet"];

/// Per request: words of which the output must contain at least one (lowercase) to count as
/// a real result for the sample input, so "I have no text to summarize" does not pass.
const EXPECTED_WORDS: &[&[&str]] = &[
    &["jakarta"],
    &["apolog", "sorry", "maaf", "regret"],
    &["pesanan", "kami", "pelanggan", "terlambat"],
    &["rina", "budi"],
    &["wallet", "leather", "dompet"],
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

/// Builds on the full-document path only, as every model did before the guided path
/// (`GRAPHRT_EVAL_FULL_DOCUMENT=1`): the "before" number for a local model.
async fn full_document_build(db: &Database, builder: &BuilderModel, request: BuildRequest) -> AppResult<Agent> {
    let kind = kind::infer_kind(&request.description);
    let messages = vec![
        Message::system(prompt::build_system_prompt(&builder.choice, &[])),
        Message::user(prompt::build_request(&request.description, kind)),
    ];
    let draft = draft_until_valid(builder, messages, &|_| {}, "Drafting the steps", &TrustedHosts::none()).await?;
    db.create_agent(NewAgent {
        name: "Eval".into(),
        kind,
        description: request.description,
        flow_yaml: draft.flow_yaml,
    })
}

/// A value for each start input: `sample_text` for every text input, whatever type the draft gave it.
fn sample_inputs(flow_yaml: &str, sample_text: &str) -> serde_json::Value {
    let mut inputs = serde_json::Map::new();
    let Ok(summary) = flow::summarize_flow(flow_yaml) else { return json!({}) };
    for input in summary.inputs {
        let value = match input.input_type.as_str() {
            "number" => json!(3),
            "checkbox" => json!(true),
            "select" => json!(input.options.first().cloned().unwrap_or_default()),
            "json" => json!({"text": sample_text}),
            _ => json!(sample_text),
        };
        inputs.insert(input.name, value);
    }
    serde_json::Value::Object(inputs)
}

/// Runs the agent to its end, approving every question with its first action.
async fn run_to_end(
    db: &Arc<Database>,
    runs: &RunManager,
    agent: &Agent,
    sample_text: &str,
    expected_words: &[&str],
) -> Result<serde_json::Value, String> {
    let inputs = sample_inputs(&agent.flow_yaml, sample_text);
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
                let lowered = outputs.to_string().to_lowercase();
                if !has_text {
                    return Err(format!("empty outputs: {outputs}"));
                }
                if !expected_words.iter().any(|word| lowered.contains(word)) {
                    return Err(format!("the output is not about the input: {outputs}"));
                }
                return Ok(outputs);
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
    let _ = log::set_logger(&PrintLogger).map(|()| log::set_max_level(log::LevelFilter::Info));
    let model_name = env_or("GRAPHRT_EVAL_MODEL", "llama3.2");
    let attempts: usize = env_or("GRAPHRT_EVAL_ATTEMPTS", "2").parse().unwrap();
    let with_runs = env_or("GRAPHRT_EVAL_RUN", "1") != "0";
    let chosen: Vec<usize> = match std::env::var("GRAPHRT_EVAL_REQUESTS") {
        Ok(list) => list.split(',').map(|index| index.trim().parse().unwrap()).collect(),
        Err(_) => (0..REQUESTS.len()).collect(),
    };
    let EvalSetup { builder, credentials, ollama_base_url } = eval_setup(&model_name);
    let full_document_only = env_or("GRAPHRT_EVAL_FULL_DOCUMENT", "0") == "1";
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
            let build_result = if full_document_only {
                full_document_build(&db, &builder, request).await
            } else {
                build_agent_with_model(&db, &builder, request, &|_| {}).await
            };
            let agent = match build_result {
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
            match run_to_end(&db, &runs, &agent, SAMPLE_TEXTS[index], EXPECTED_WORDS[index]).await {
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

/// Chatbots a small business would ask for first, with one customer message each and
/// words of which the reply must contain one (lowercase).
/// `GRAPHRT_EVAL_REQUESTS=3` picks some of them.
const CHATBOT_REQUESTS: &[(&str, &str, &[&str])] = &[
    (
        "Answer customer questions for my bakery about opening hours (8 to 17, closed Sunday) and cake prices \
         (brownies 50k, cheesecake 120k). Hand over to me for custom orders.",
        "How much is the cheesecake?",
        &["120"],
    ),
    (
        "Answer WhatsApp questions about our catering menu (nasi box 25k, tumpeng 350k, minimum order 20 boxes) \
         and pass confirmed orders to me.",
        "Berapa harga nasi box?",
        &["25"],
    ),
    (
        "A chatbot for my laundry shop: prices are 8k per kg, express 15k per kg, pickup between 9 and 18. If a \
         customer is upset, hand the chat to me.",
        "How much is express laundry?",
        &["15"],
    ),
    (
        "Answer patients' questions about our dental clinic: open Monday to Saturday 9-20, scaling costs 300k. \
         When someone wants to book or asks for a person, hand over to the front desk.",
        "Are you open on Saturday?",
        &["saturday", "sabtu", "yes", "open"],
    ),
];

/// Prints the builder's info lines (every repair problem) while the eval runs.
struct PrintLogger;

impl log::Log for PrintLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Info && metadata.target().starts_with("graphrt_lib::")
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            println!("    log {}: {}", record.target(), first_line(&record.args().to_string()));
        }
    }
    fn flush(&self) {}
}

#[derive(Debug)]
struct QuietConversationSink;

impl crate::conversations::ConversationEventSink for QuietConversationSink {
    fn send(&self, _payload: crate::conversations::ConversationEventPayload) {}
}

/// Builds each chatbot of [`CHATBOT_REQUESTS`] `GRAPHRT_EVAL_ATTEMPTS` times as the New agent
/// screen does ("Answer customers"), counts the repair rounds, then sends the customer
/// message once in a test chat: an attempt works when the bot answers with one of the words.
///
/// ```sh
/// GRAPHRT_EVAL_PROVIDER=openai GRAPHRT_EVAL_MODEL=gpt-4.1-mini OPENAI_API_KEY=... \
///   cargo test --manifest-path src-tauri/Cargo.toml live_eval_chatbots -- --ignored --nocapture
/// ```
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a real model (Ollama or OPENAI_API_KEY)"]
async fn live_eval_chatbots() {
    let _ = log::set_logger(&PrintLogger).map(|()| log::set_max_level(log::LevelFilter::Info));
    let model_name = env_or("GRAPHRT_EVAL_MODEL", "llama3.2");
    let attempts: usize = env_or("GRAPHRT_EVAL_ATTEMPTS", "2").parse().unwrap();
    let EvalSetup { builder, credentials, ollama_base_url } = eval_setup(&model_name);
    let (mut total, mut built, mut first_try, mut answered) = (0, 0, 0, 0);
    let chosen: Vec<usize> = match std::env::var("GRAPHRT_EVAL_REQUESTS") {
        Ok(list) => list.split(',').map(|index| index.trim().parse().unwrap()).collect(),
        Err(_) => (0..CHATBOT_REQUESTS.len()).collect(),
    };
    for index in chosen {
        let (description, customer_message, expected_words) = CHATBOT_REQUESTS[index];
        for attempt in 1..=attempts {
            total += 1;
            let db = Arc::new(Database::open_in_memory().unwrap());
            db.set_setting(crate::credentials::SETTING_OLLAMA_BASE_URL, &ollama_base_url).unwrap();
            let started = Instant::now();
            let repairs = std::sync::atomic::AtomicUsize::new(0);
            let on_progress = |progress: BuildProgress| {
                if progress.stage == BuildStage::Repairing && progress.draft.is_none() {
                    repairs.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            };
            let request = BuildRequest { description: (*description).into(), kind: Some(AgentKind::Chatbot) };
            let agent = match build_agent_with_model(&db, &builder, request, &on_progress).await {
                Ok(agent) => agent,
                Err(error) => {
                    println!("[{model_name}] c{index} a{attempt} BUILD-FAIL {}", first_line(&error.to_string()));
                    continue;
                }
            };
            built += 1;
            let repairs = repairs.into_inner();
            if repairs == 0 {
                first_try += 1;
            }
            let seconds = started.elapsed().as_secs();
            if std::env::var("GRAPHRT_EVAL_SHOW").is_ok() {
                println!("{}", agent.flow_yaml);
            }
            let conversations = crate::conversations::ConversationManager::new(
                db.clone(),
                credentials.clone(),
                Arc::new(QuietConversationSink),
            );
            let chat = conversations.start_test_conversation(&agent.id).unwrap().conversation;
            let detail = conversations.send_customer_message(&chat.id, customer_message).await;
            let reply = detail
                .ok()
                .and_then(|detail| detail.messages.last().cloned())
                .map(|message| format!("{:?}: {}", message.author, message.text))
                .unwrap_or_else(|| "no reply".into());
            let lowered = reply.to_lowercase();
            let works = lowered.starts_with("bot:") && expected_words.iter().any(|word| lowered.contains(word));
            if works {
                answered += 1;
            }
            let verdict = if works { "ANSWERED" } else { "NO-ANSWER" };
            println!(
                "[{model_name}] c{index} a{attempt} BUILT {seconds}s repairs {repairs} {verdict}: {}",
                first_line(&reply)
            );
        }
    }
    println!(
        "[{model_name}] CHATBOTS built {built}/{total}, first try {first_try}/{total}, answered {answered}/{total}"
    );
}
