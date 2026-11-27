//! Measures how often the builder makes a working agent with a real model.
//!
//! Not part of the normal test run (`#[ignore]`): it needs Ollama with the model pulled, or
//! with `GRAPHRT_EVAL_PROVIDER=openai` an `OPENAI_API_KEY`. It installs the `email` and
//! `currency-rates` plugins from the live catalog (network, Node.js).
//!
//! ```sh
//! GRAPHRT_EVAL_OLLAMA=http://127.0.0.1:11434 GRAPHRT_EVAL_MODEL=llama3.2 GRAPHRT_EVAL_ATTEMPTS=10 \
//!   cargo test --manifest-path src-tauri/Cargo.toml live_eval -- --ignored --nocapture
//! ```
//!
//! For every scenario it builds an agent `GRAPHRT_EVAL_ATTEMPTS` times (default 2), applies
//! the scenario's chat change if it has one, then runs the agent once with sample inputs,
//! approving every question. An attempt counts as working when the scenario's own check
//! passes ([`Scenario`]). Set `GRAPHRT_EVAL_REQUESTS=0,3` to use only some scenarios and
//! `GRAPHRT_EVAL_RUN=0` to skip the runs. `GRAPHRT_EVAL_FULL_DOCUMENT=1` builds on the
//! full-document path only (the number before the guided path existed).
//! `GRAPHRT_EVAL_PLUGIN_DIR` keeps the installed plugins between runs.

use std::sync::Arc;
use std::time::{Duration, Instant};

use graphrt_llm::openai::{OpenAiConfig, OpenAiModel};
use serde_json::json;

use super::*;
use crate::engine::{RunEventPayload, RunEventSink, RunManager};
use crate::plugins::download::HttpsDownloader;
use crate::plugins::events::PluginEventSink;
use crate::plugins::models::PluginEvent;
use crate::plugins::{PluginService, PluginServiceConfig};
use crate::storage::models::{RunStatus, RunTrigger};

const NOTES: &str = "Our order of 20 lunch boxes arrived two hours late and cold. Rina will call the customer by \
                     Friday and Budi will refund the delivery fee.";
const ADDRESS: &str = "budi@example.test";
const ARTICLE: &str = "https://en.wikipedia.org/wiki/Nasi_goreng";

/// What must be true, besides a run that ends well, for an attempt to count as working.
#[derive(Clone, Copy, Default)]
struct Needs {
    /// The run asked the person at least once.
    asks_first: bool,
    /// The run reached this plugin step. A step that sends counts as reached when the
    /// question before it showed [`ADDRESS`]; the mail itself is not delivered (no account).
    plugin_step: Option<&'static str>,
    /// A schedule was saved for the agent, turned off.
    paused_schedule: bool,
}

/// One job a business user might type, and how to tell that the built agent does it.
struct Scenario {
    /// The kind of job, for the report.
    job: &'static str,
    description: &'static str,
    /// What the person types into a text input that is not an address, a link or a place.
    sample_text: &'static str,
    /// Words of which the output must contain at least one (lowercase), so that "I have
    /// no text to summarize" does not pass.
    expected_words: &'static [&'static str],
    needs: Needs,
    /// A change asked for in the builder chat before the run, and the words the output
    /// must then also contain one of.
    change: Option<(&'static str, &'static [&'static str])>,
}

const NO_NEEDS: Needs = Needs { asks_first: false, plugin_step: None, paused_schedule: false };

const SCENARIOS: &[Scenario] = &[
    Scenario {
        job: "lookup (data address)",
        description: "Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it",
        sample_text: "Jakarta",
        expected_words: &["jakarta"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "writing",
        description: "Write a polite reply to a customer complaint that I paste in",
        sample_text: NOTES,
        expected_words: &["apolog", "sorry", "maaf", "regret"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "writing",
        description: "Translate the text I give into Indonesian and make it sound formal",
        sample_text: NOTES,
        expected_words: &["pesanan", "kami", "pelanggan", "terlambat"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "writing",
        description: "Take my meeting notes and turn them into a list of action items with owners",
        sample_text: NOTES,
        expected_words: &["rina", "budi"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "writing",
        description: "Write three Instagram caption ideas for a product I describe",
        sample_text: "Handmade leather wallet",
        expected_words: &["wallet", "leather", "dompet"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "lookup (web page)",
        description: "Read the web page at a link I give and summarize it in three bullet points",
        sample_text: ARTICLE,
        expected_words: &["rice", "nasi"],
        needs: NO_NEEDS,
        change: None,
    },
    Scenario {
        job: "send (email plugin)",
        description: "Write a short thank-you note to a customer and send it by email to the address I give",
        sample_text: "Budi, who ordered 20 lunch boxes",
        expected_words: &["thank"],
        needs: Needs { plugin_step: Some("email.send_email"), ..NO_NEEDS },
        change: None,
    },
    Scenario {
        job: "send (email plugin)",
        description:
            "Ringkas catatan rapat yang saya tempel lalu kirim ringkasannya lewat email ke alamat yang saya isi",
        sample_text: NOTES,
        expected_words: &["rina", "budi"],
        needs: Needs { plugin_step: Some("email.send_email"), ..NO_NEEDS },
        change: None,
    },
    Scenario {
        job: "approval",
        description: "Draft a reply to a customer complaint I paste and ask me to approve it before finishing",
        sample_text: NOTES,
        expected_words: &["apolog", "sorry", "maaf", "regret"],
        needs: Needs { asks_first: true, ..NO_NEEDS },
        change: None,
    },
    Scenario {
        job: "schedule",
        description:
            "Every morning look up the Wikipedia page summary for Jakarta and write a one sentence note about the city",
        sample_text: "Jakarta",
        expected_words: &["jakarta"],
        needs: Needs { paused_schedule: true, ..NO_NEEDS },
        change: None,
    },
    Scenario {
        job: "plugin that reads",
        description: "Get the latest US dollar to Indonesian rupiah exchange rate and write one sentence about it",
        sample_text: "USD",
        expected_words: &["rupiah", "idr"],
        needs: Needs { plugin_step: Some("currency-rates."), ..NO_NEEDS },
        change: None,
    },
    Scenario {
        job: "change in the chat",
        description: "Write a polite reply to a customer complaint that I paste in",
        sample_text: NOTES,
        expected_words: &["maaf", "mohon", "kami", "pelanggan"],
        needs: NO_NEEDS,
        change: Some((
            "Write the reply in Indonesian and offer a 10% discount on the next order",
            &["10%", "10 %", "diskon"],
        )),
    },
    Scenario {
        job: "change in the chat",
        description: "Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it",
        sample_text: "Jakarta",
        expected_words: &["jakarta"],
        needs: Needs { asks_first: true, ..NO_NEEDS },
        change: Some(("Ask me to approve the summary before finishing", &["jakarta"])),
    },
];

const RUN_TIMEOUT: Duration = Duration::from_secs(420);

#[derive(Debug)]
struct QuietSink;

impl RunEventSink for QuietSink {
    fn send(&self, _payload: RunEventPayload) {}
}

impl PluginEventSink for QuietSink {
    fn send(&self, _event: PluginEvent) {}
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

/// Installs the plugins the scenarios use and publishes them, as the app does at start.
/// The email plugin gets an SMTP server that does not exist: its sending step is reached
/// and fails at the connection, which is as far as a test without an account can go.
async fn install_plugins(credentials: Arc<CredentialStore>) -> (PluginService, Option<tempfile::TempDir>) {
    let (app_data_dir, kept_alive) = match std::env::var("GRAPHRT_EVAL_PLUGIN_DIR") {
        Ok(dir) => (std::path::PathBuf::from(dir), None),
        Err(_) => {
            let dir = tempfile::tempdir().unwrap();
            (dir.path().to_path_buf(), Some(dir))
        }
    };
    std::fs::create_dir_all(&app_data_dir).unwrap();
    let service = PluginService::new(PluginServiceConfig {
        app_data_dir: app_data_dir.clone(),
        catalog_url: crate::plugins::DEFAULT_CATALOG_URL.to_owned(),
        db: Arc::new(Database::open_in_memory().unwrap()),
        credentials,
        node_runtime: Arc::new(crate::node_runtime::NodeRuntime::new(app_data_dir)),
        downloader: Arc::new(HttpsDownloader::new().unwrap()),
        events: Arc::new(QuietSink),
    });
    let catalog = service.catalog(true).await.unwrap();
    for name in ["email", "currency-rates"] {
        let entry = catalog
            .plugins
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("{name} is not in the catalog"));
        let installed =
            service.install(name, &entry.permissions).await.unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(installed.load_error, None, "{name}");
    }
    let email = catalog.plugins.iter().find(|entry| entry.name == "email").unwrap();
    service.set_trusted("email", true, Some(&email.permissions)).await.unwrap();
    for (variable, value) in [
        ("EMAIL_SMTP_HOST", "127.0.0.1"),
        ("EMAIL_SMTP_PORT", "2525"),
        ("EMAIL_SMTP_SECURE", "false"),
        ("EMAIL_SMTP_USER", "agent@example.test"),
        ("EMAIL_FROM", "agent@example.test"),
        ("EMAIL_PASSWORD", "not-a-real-password"),
    ] {
        service.set_config("email", variable, value).await.unwrap_or_else(|error| panic!("{variable}: {error}"));
    }
    service.activate();
    (service, kept_alive)
}

/// Installs catalog plugins a drafted agent uses, accepting their permissions as the
/// person's click on "Install" does.
async fn install_from_catalog(plugins: &PluginService, names: &[String]) -> Result<(), String> {
    let catalog = plugins.catalog(false).await.map_err(|error| format!("catalog: {error}"))?;
    for name in names {
        let entry = catalog
            .plugins
            .iter()
            .find(|entry| &entry.name == name)
            .ok_or_else(|| format!("the agent needs `{name}`, which is not in the catalog"))?;
        let installed =
            plugins.install(name, &entry.permissions).await.map_err(|error| format!("install {name}: {error}"))?;
        if let Some(problem) = installed.load_error {
            return Err(format!("{name} does not load: {problem}"));
        }
    }
    plugins.activate();
    Ok(())
}

/// A value for each start input: an address, a link or a place where the input's name or
/// label asks for one, else the scenario's sample text, whatever type the draft gave it.
fn sample_inputs(flow_yaml: &str, sample_text: &str) -> serde_json::Value {
    let mut inputs = serde_json::Map::new();
    let Ok(summary) = flow::summarize_flow(flow_yaml) else { return json!({}) };
    for input in summary.inputs {
        let asked_for = format!("{} {}", input.name, input.label).to_lowercase();
        let mentions = |words: &[&str]| words.iter().any(|word| asked_for.contains(word));
        let text = if mentions(&["mail", "address", "alamat", "recipient", "penerima"]) {
            ADDRESS
        } else if mentions(&["link", "url", "tautan", "page"]) {
            ARTICLE
        } else if mentions(&["city", "kota", "place", "location", "topic"]) && sample_text != ARTICLE {
            "Jakarta"
        } else {
            sample_text
        };
        let value = match input.input_type.as_str() {
            "number" => json!(3),
            "checkbox" => json!(true),
            "select" => json!(input.options.first().cloned().unwrap_or_default()),
            "json" => json!({"text": text}),
            _ => json!(text),
        };
        inputs.insert(input.name, value);
    }
    serde_json::Value::Object(inputs)
}

/// What a finished run looked like.
struct RunReport {
    outputs: serde_json::Value,
    /// The questions the run asked, as the person saw them.
    questions: Vec<String>,
    /// How the run ended when it did not succeed.
    failure: Option<String>,
}

/// Runs the agent to its end, approving every question.
async fn run_to_end(
    db: &Arc<Database>,
    runs: &RunManager,
    plugins: &PluginService,
    agent: &Agent,
    sample_text: &str,
) -> Result<RunReport, String> {
    let inputs = sample_inputs(&agent.flow_yaml, sample_text);
    let run = match runs.start_run(&agent.id, RunTrigger::Test, inputs.clone()).await {
        Ok(run) => run,
        // The person clicks "Install" on the plugins a drafted agent uses, then runs it.
        Err(crate::error::AppError::MissingPlugins(names)) => {
            install_from_catalog(plugins, &names).await?;
            runs.start_run(&agent.id, RunTrigger::Test, inputs).await.map_err(|error| format!("start: {error}"))?
        }
        Err(error) => return Err(format!("start: {error}")),
    };
    let started = Instant::now();
    let mut questions = Vec::new();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let current = db.get_run(&run.id).map_err(|error| error.to_string())?;
        match current.status {
            RunStatus::Running if started.elapsed() > RUN_TIMEOUT => return Err("run timed out".into()),
            RunStatus::Running => {}
            RunStatus::Succeeded => {
                return Ok(RunReport { outputs: current.outputs.unwrap_or_default(), questions, failure: None });
            }
            RunStatus::Failed | RunStatus::Aborted => {
                let failure = Some(current.error_message.unwrap_or_default());
                return Ok(RunReport { outputs: serde_json::Value::Null, questions, failure });
            }
            RunStatus::Paused => {
                let review = crate::run_review::get_run_review(db, &run.id).map_err(|error| error.to_string())?;
                let mut answers = serde_json::Map::new();
                for question in &review.pending {
                    questions.push(question.prompt.clone().unwrap_or_default());
                    let answer = match question.tool_call.as_ref() {
                        Some(call) => json!({"approvals": {call.call_id.clone(): true}}),
                        None => {
                            let approving =
                                ["approve", "send", "yes", "confirm", "continue", "proceed", "fetch", "search"];
                            let action = question
                                .actions
                                .iter()
                                .find(|action| approving.contains(&action.id.as_str()))
                                .or(question.actions.first())
                                .map(|action| action.id.clone())
                                .unwrap_or_default();
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

/// Whether the run did what the scenario asks. `Err` says what is missing.
fn judge(scenario: &Scenario, agent: &Agent, report: &RunReport, db: &Database) -> Result<String, String> {
    let asked = report.questions.join("\n---\n");
    let sends = scenario.needs.plugin_step.is_some_and(|step| !step.ends_with('.'));
    // What the person would read: the output, or for a sending job what they were asked to send.
    let shown = if sends { asked.to_lowercase() } else { report.outputs.to_string().to_lowercase() };
    if let Some(step) = scenario.needs.plugin_step {
        // A plugin's operation as a step of its own, or as a tool of a `tool` step.
        let plugin = step.split('.').next().unwrap_or_default();
        let as_tool = format!("provider_id: {plugin}");
        if !agent.flow_yaml.contains(&format!("type: {step}")) && !agent.flow_yaml.contains(&as_tool) {
            return Err(format!("no `{step}` step in the agent"));
        }
    }
    if sends {
        if !asked.contains(ADDRESS) {
            return Err(format!("the question before sending does not show the address: {asked:?}"));
        }
        // No mail account exists: the sending step is reached when the run got past the question.
        match &report.failure {
            None => {}
            Some(failure) if failure.to_lowercase().contains("smtp") || failure.contains("ECONNREFUSED") => {}
            Some(failure) => return Err(format!("run failed before sending: {failure}")),
        }
    } else if let Some(failure) = &report.failure {
        return Err(format!("run failed: {failure}"));
    }
    if scenario.needs.asks_first && report.questions.is_empty() {
        return Err("the run never asked the person".into());
    }
    if scenario.needs.paused_schedule {
        let triggers = db.list_triggers(Some(&agent.id)).map_err(|error| error.to_string())?;
        match triggers.as_slice() {
            [trigger] if !trigger.enabled => {}
            [] => return Err("no schedule was saved".into()),
            _ => return Err("the schedule is on, or there are several".into()),
        }
    }
    let has_one_of = |words: &[&str]| words.iter().any(|word| shown.contains(word));
    if !has_one_of(scenario.expected_words) {
        return Err(format!("the result is not about the input: {}", first_line(&shown)));
    }
    if let Some((_, changed_words)) = scenario.change {
        if !has_one_of(changed_words) {
            return Err(format!("the change did not show in the result: {}", first_line(&shown)));
        }
    }
    Ok(first_line(&shown))
}

/// Builds on the full-document path only, as every model did before the guided path
/// (`GRAPHRT_EVAL_FULL_DOCUMENT=1`): the "before" number for a local model.
async fn full_document_build(db: &Database, builder: &BuilderModel, request: BuildRequest) -> AppResult<Agent> {
    let kind = kind::infer_kind(&request.description);
    let messages = vec![
        Message::system(prompt::build_system_prompt(&builder.choice, &[], &request.description)),
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

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().chars().take(220).collect()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a running Ollama with the model pulled (or an OpenAI key), the network and Node.js"]
async fn live_eval() {
    let _ = log::set_logger(&PrintLogger).map(|()| log::set_max_level(log::LevelFilter::Info));
    let model_name = env_or("GRAPHRT_EVAL_MODEL", "llama3.2");
    let attempts: usize = env_or("GRAPHRT_EVAL_ATTEMPTS", "2").parse().unwrap();
    let with_runs = env_or("GRAPHRT_EVAL_RUN", "1") != "0";
    let chosen: Vec<usize> = match std::env::var("GRAPHRT_EVAL_REQUESTS") {
        Ok(list) => list.split(',').map(|index| index.trim().parse().unwrap()).collect(),
        Err(_) => (0..SCENARIOS.len()).collect(),
    };
    let EvalSetup { builder, credentials, ollama_base_url } = eval_setup(&model_name);
    let full_document_only = env_or("GRAPHRT_EVAL_FULL_DOCUMENT", "0") == "1";
    let (plugins, _plugin_dir) = install_plugins(credentials.clone()).await;
    let (mut total, mut built, mut worked) = (0, 0, 0);
    for index in chosen {
        let scenario = &SCENARIOS[index];
        let (mut scenario_built, mut scenario_worked) = (0, 0);
        for attempt in 1..=attempts {
            total += 1;
            let db = Arc::new(Database::open_in_memory().unwrap());
            // Runs read the Ollama address from the app's settings.
            db.set_setting(crate::credentials::SETTING_OLLAMA_BASE_URL, &ollama_base_url).unwrap();
            let started = Instant::now();
            let request = BuildRequest { description: scenario.description.into(), kind: None };
            let mut build_result = if full_document_only {
                full_document_build(&db, &builder, request).await
            } else {
                build_agent_with_model(&db, &builder, request, &|_| {}).await
            };
            if let (Ok(agent), Some((change, _))) = (&build_result, scenario.change) {
                build_result = revise_agent_with_model(&db, &builder, &agent.id, change, &|_| {})
                    .await
                    .map(|revision| revision.agent);
            }
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
            scenario_built += 1;
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
            let outcome = match run_to_end(&db, &runs, &plugins, &agent, scenario.sample_text).await {
                Ok(report) => judge(scenario, &agent, &report, &db),
                Err(problem) => Err(problem),
            };
            match outcome {
                Ok(shown) => {
                    worked += 1;
                    scenario_worked += 1;
                    println!("[{model_name}] r{index} a{attempt} WORKED build {build_seconds}s: {shown}");
                }
                Err(problem) => {
                    println!(
                        "[{model_name}] r{index} a{attempt} RUN-FAIL build {build_seconds}s: {}",
                        first_line(&problem)
                    )
                }
            }
        }
        println!(
            "[{model_name}] r{index} built {scenario_built}/{attempts} worked {scenario_worked}/{attempts}: {} | {}",
            scenario.job, scenario.description
        );
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
