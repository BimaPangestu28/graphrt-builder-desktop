//! Shared state handed to every Tauri command.

use std::sync::Arc;

use crate::chains::ChainRunner;
use crate::credentials::CredentialStore;
use crate::engine::RunManager;
use crate::scheduler::SchedulerHandle;
use crate::storage::Database;

#[derive(Debug)]
pub struct AppState {
    pub db: Arc<Database>,
    pub credentials: Arc<CredentialStore>,
    pub runs: Arc<RunManager>,
    pub scheduler: SchedulerHandle,
    /// Starts the next agents of chains when runs finish.
    pub chains: Arc<ChainRunner>,
}
