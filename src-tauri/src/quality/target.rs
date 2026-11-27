//! What a check runs: the agent at one version, the way it runs for real, as a graphrt
//! eval [`Target`]. graphrt's harness then scores every reply.
//!
//! - A task agent: its workflow compiled once, each question given to its main input.
//! - A chatbot: every question goes through the chatbot's own reply path (its saved
//!   persona, rules and knowledge, `chatbot_setup::reply`), as a customer message would.
//!
//! A check never approves anything: a step that waits for a person's OK pauses the run,
//! and graphrt counts that test as not good. Each question has [`QUESTION_TIMEOUT`].

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use futures::StreamExt;
use graphrt_core::response::ResponseAssembler;
use graphrt_core::{Engine, IndexMap, RunInput, Selector, Value};
use graphrt_eval::{EngineTarget, EvalError, RunCapture, RunStatus, Target, TestCase};

use crate::agent_files::AgentFiles;
use crate::chatbot_setup::reply::prepare_reply;
use crate::conversations::bot::MESSAGE_INPUT;
use crate::credentials::CredentialStore;
use crate::engine::{agent_tools_for, prepare_engine_and_env, ModelRegistrySource};
use crate::error::AppResult;
use crate::storage::models::{Agent, AgentKind};
use crate::storage::Database;

/// Longest one question may take before its test counts as not good.
pub const QUESTION_TIMEOUT: Duration = Duration::from_secs(180);
/// `sys.conversation_id` and `sys.user_id` of a check's chatbot turns.
const CHECK_CONVERSATION: &str = "test-check";

/// What every run of a check needs from the app.
#[derive(Clone, Debug)]
pub struct CheckDependencies {
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub model_source: Arc<dyn ModelRegistrySource>,
    pub agent_files: Option<Arc<AgentFiles>>,
}

impl CheckDependencies {
    /// The engine and `env.*` values of `flow_yaml` for the agent `agent_id`.
    fn engine_for(&self, agent_id: &str, flow_yaml: &str) -> AppResult<(Engine, IndexMap<String, Value>)> {
        let tools = agent_tools_for(
            self.db.clone(),
            self.credentials.clone(),
            self.model_source.clone(),
            self.agent_files.clone(),
            agent_id,
        );
        let trusted_hosts = self.db.trusted_lookup_hosts(agent_id)?;
        prepare_engine_and_env(flow_yaml, &trusted_hosts, &self.credentials, &self.db, &*self.model_source, tools, None)
    }

    /// An engine for a workflow that is not an agent's (a judge): no agent tools.
    pub fn plain_engine(&self, flow_yaml: &str) -> AppResult<Engine> {
        let trusted_hosts = crate::flow::TrustedHosts::default();
        let tools = graphrt_core::tool::ToolRegistry::new();
        let (engine, _env) = prepare_engine_and_env(
            flow_yaml,
            &trusted_hosts,
            &self.credentials,
            &self.db,
            &*self.model_source,
            tools,
            None,
        )?;
        Ok(engine)
    }
}

/// The agent under test. `agent.flow_yaml` is the flow of the version being checked.
pub enum AgentTarget {
    Task { target: EngineTarget },
    Chatbot { dependencies: CheckDependencies, agent: Agent },
}

impl std::fmt::Debug for AgentTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Task { .. } => formatter.write_str("AgentTarget::Task"),
            Self::Chatbot { agent, .. } => write!(formatter, "AgentTarget::Chatbot({})", agent.id),
        }
    }
}

impl AgentTarget {
    /// Prepares the agent for a check. A task agent is compiled here, so a flow that cannot
    /// run fails before any question is asked.
    ///
    /// # Errors
    /// Whatever preparing a normal run reports (missing keys, plugins, a broken flow).
    pub fn new(dependencies: CheckDependencies, agent: Agent) -> AppResult<Self> {
        match agent.kind {
            AgentKind::Chatbot => {
                // Compiling once up front reports a broken flow or a missing key before the first question.
                dependencies.engine_for(&agent.id, &agent.flow_yaml)?;
                Ok(Self::Chatbot { dependencies, agent })
            }
            AgentKind::Task | AgentKind::Chain | AgentKind::Team => {
                let (engine, env) = dependencies.engine_for(&agent.id, &agent.flow_yaml)?;
                Ok(Self::Task { target: EngineTarget::new(engine).with_env(env) })
            }
        }
    }

    async fn run_chatbot(dependencies: &CheckDependencies, agent: &Agent, case: &TestCase) -> RunCapture {
        let question = case.vars.get(MESSAGE_INPUT).and_then(|value| value.as_str()).unwrap_or_default();
        let started = Instant::now();
        let prepared = match prepare_reply(&dependencies.db, &dependencies.credentials, agent, question).await {
            Ok(prepared) => prepared,
            Err(error) => return failed_capture(&error.to_string(), started),
        };
        let (engine, env) = match dependencies.engine_for(&agent.id, &prepared.flow_text) {
            Ok(prepared_engine) => prepared_engine,
            Err(error) => return failed_capture(&error.to_string(), started),
        };
        let mut input = RunInput::new()
            .input(MESSAGE_INPUT, question)
            .sys("query", question)
            .sys("conversation_id", CHECK_CONVERSATION)
            .sys("user_id", CHECK_CONVERSATION);
        input.env = env;
        let mut assembler = ResponseAssembler::new(engine.graph());
        for (name, value) in &prepared.sys_values {
            input = input.sys(name.as_str(), value.as_str());
            assembler = assembler.with_value(&Selector::of("sys", name), Value::from(value.as_str()));
        }
        let mut events = Vec::new();
        let mut stream = engine.run(input);
        while let Some(event) = stream.next().await {
            let _chunks = assembler.push(&event);
            events.push(event);
        }
        let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        RunCapture::from_events(events, assembler.text_so_far().to_owned(), latency_ms)
    }
}

impl Target for AgentTarget {
    fn run<'a>(&'a self, case: &'a TestCase) -> BoxFuture<'a, Result<RunCapture, EvalError>> {
        Box::pin(async move {
            let started = Instant::now();
            let run = async {
                match self {
                    Self::Task { target } => target.run(case).await,
                    Self::Chatbot { dependencies, agent } => Ok(Self::run_chatbot(dependencies, agent, case).await),
                }
            };
            match tokio::time::timeout(QUESTION_TIMEOUT, run).await {
                Ok(result) => result,
                Err(_elapsed) => Ok(failed_capture("the agent took too long to answer", started)),
            }
        })
    }

    fn start_variables(&self) -> Vec<(String, String)> {
        match self {
            Self::Task { target } => target.start_variables(),
            Self::Chatbot { .. } => vec![(MESSAGE_INPUT.to_owned(), "paragraph".to_owned())],
        }
    }
}

/// A run that could not happen: graphrt counts its test as an error (not good).
fn failed_capture(message: &str, started: Instant) -> RunCapture {
    let mut capture = RunCapture::default();
    capture.status = RunStatus::Failed;
    capture.error = Some(message.to_owned());
    capture.latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    capture
}
