//! Tauri commands, grouped by feature. Each one only validates arguments and
//! delegates to its module; the frontend wrappers live in `src/api/`.
//! Argument names are camelCase on the JavaScript side (Tauri's default).

pub mod agent_tools;
pub mod agents;
pub mod app_settings;
pub mod builder;
pub mod chains;
pub mod conversations;
pub mod credentials;
pub mod knowledge;
pub mod run_summary;
pub mod runs;
pub mod triggers;
pub mod versions;
