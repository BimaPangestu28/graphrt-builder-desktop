//! Tauri commands, grouped by feature. Each one only validates arguments and
//! delegates to its module; the frontend wrappers live in `src/api/`.
//! Argument names are camelCase on the JavaScript side (Tauri's default).

pub mod agents;
pub mod builder;
pub mod conversations;
pub mod credentials;
pub mod runs;
pub mod triggers;
