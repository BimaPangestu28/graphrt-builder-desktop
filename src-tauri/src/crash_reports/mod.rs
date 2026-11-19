//! Local, privacy-first crash reports. graphrt sends no telemetry.
//!
//! When the backend panics or the window hits an uncaught error, a scrubbed
//! JSON report is written to `<app data>/crash-reports/<timestamp>-<id>.json`
//! on this computer, and nowhere else. Settings > Privacy and data lists the
//! reports, shows each one exactly as it would be shared, exports or deletes
//! them. After a panic, the next launch shows a small notice; if the user opted
//! in, it also offers to open a prefilled GitHub issue they can review and submit.
//!
//! - [`scrub`]: removes home folders, account names, keys, tokens and emails
//! - [`report`]: the report JSON, built from a panic or a frontend error, capped at 64 KB
//! - [`store`]: the folder (at most 50 reports), list / read / export / delete
//! - [`panic_hook`]: the process-wide hook, chained before the default one
//! - [`sharing`]: the opt-in, the notice's dismissed marker and the GitHub issue link
//!
//! Commands are in [`crate::commands::crash_reports`]; the store is Tauri state.

pub mod panic_hook;
pub mod report;
pub mod scrub;
pub mod sharing;
pub mod store;

use std::sync::Arc;

use tauri::Manager;

pub use report::{CrashReport, CrashReportKind, FrontendErrorInput};
pub use store::{CrashReportStore, CRASH_REPORTS_DIR_NAME};

/// Creates the store for this app data folder, installs the panic hook and
/// registers the store as Tauri state. Call first in `setup`, so panics while
/// the rest of the app starts are reported too.
///
/// @throws tauri::Error - when the OS gives no app data folder
pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let home_folder = app.path().home_dir().ok().map(|folder| folder.display().to_string());
    let environment = report::ReportEnvironment {
        app_version: app.package_info().version.to_string(),
        scrubber: scrub::Scrubber::new(home_folder.as_deref()),
    };
    let store = Arc::new(CrashReportStore::new(data_dir.join(CRASH_REPORTS_DIR_NAME), environment));
    panic_hook::install_panic_hook(store.clone());
    app.manage(store);
    Ok(())
}
