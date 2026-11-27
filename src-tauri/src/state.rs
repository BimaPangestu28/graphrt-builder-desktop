//! Shared state handed to every Tauri command.

use std::sync::Arc;

use crate::chains::ChainRunner;
use crate::credentials::CredentialStore;
use crate::engine::RunManager;
use crate::knowledge::KnowledgeService;
use crate::node_runtime::NodeRuntime;
use crate::scheduler::SchedulerHandle;
use crate::storage::Database;

#[derive(Debug)]
pub struct AppState {
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub runs: Arc<RunManager>,
    pub scheduler: SchedulerHandle,
    pub conversations: Arc<crate::conversations::ConversationManager>,
    /// Starts the next agents of chains when runs finish.
    pub chains: Arc<ChainRunner>,
    pub knowledge: Arc<KnowledgeService>,
    /// The bundled Node plugins run on, and the Playwright browser cache.
    pub node_runtime: Arc<NodeRuntime>,
    /// Installed graphrt plugins (they run on `node_runtime`).
    pub plugins: Arc<crate::plugins::PluginService>,
    /// Agent skills: the catalog's, the ones written here, and what each may use.
    pub skills: Arc<crate::skills::SkillService>,
    /// What agents learned: lessons, the ones waiting for the owner, feedback on runs.
    pub learning: Arc<crate::learning::LearningService>,
    /// The chat models each connected provider offers (cached).
    pub model_catalog: Arc<crate::model_catalog::ModelCatalog>,
    /// Put it online: online accounts, deployments and the graphrt tools.
    pub deploy: Arc<crate::deploy::DeployService>,
    /// The agents' file workspaces: what people attach and the files agents make.
    pub agent_files: Arc<crate::agent_files::AgentFiles>,
    /// Plugin events that start agents (watchers run in the background).
    pub plugin_triggers: Arc<crate::plugin_triggers::PluginTriggerService>,
}
