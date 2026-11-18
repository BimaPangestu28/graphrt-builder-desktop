//! "Daily summary at 18:00" (Settings > Notifications): once a day, at or after
//! [`SUMMARY_HOUR`] local time, one notification counting the runs of the last
//! 24 hours by outcome. Covering a full 24 hours (not only since midnight)
//! means a run started after yesterday's summary is never left out.
//!
//! A background loop checks every [`CHECK_INTERVAL`]; the date of the last
//! summary is stored (`app.daily_summary_last_sent`) so a restart does not
//! send it twice. If the app was not running at 18:00, the summary comes when
//! it starts later that evening. Days without runs send nothing. Test runs
//! from the builder are not counted.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Timelike, Utc};

use super::app_settings::AppSettings;
use super::notify::PlainNotifier;
use crate::error::AppResult;
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Local hour from which the day's summary is due.
pub const SUMMARY_HOUR: u32 = 18;
/// How often the loop checks whether a summary is due.
const CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);
const KEY_LAST_SENT_DATE: &str = "app.daily_summary_last_sent";

/// Starts the daily summary loop on the Tauri async runtime.
pub fn spawn(db: Arc<Database>, notifier: Arc<dyn PlainNotifier>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(CHECK_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if let Err(error) = send_if_due(&db, notifier.as_ref(), chrono::Local::now()) {
                log::warn!("could not send the daily summary: {error}");
            }
        }
    });
}

/// Sends today's summary when it is enabled, due and not sent yet; returns
/// whether a notification was shown.
///
/// # Errors
/// `Database` when settings or runs cannot be read or the date cannot be stored.
pub fn send_if_due<Zone: TimeZone>(
    db: &Database,
    notifier: &dyn PlainNotifier,
    now: DateTime<Zone>,
) -> AppResult<bool> {
    if !AppSettings::load_or_default(db).notify_daily_summary || now.hour() < SUMMARY_HOUR {
        return Ok(false);
    }
    let today = now.date_naive().to_string();
    if db.get_setting(KEY_LAST_SENT_DATE)?.as_deref() == Some(today.as_str()) {
        return Ok(false);
    }
    let since = (now.with_timezone(&Utc) - chrono::Duration::hours(24)).to_rfc3339();
    let runs: Vec<Run> =
        db.list_runs_started_since(&since, None)?.into_iter().filter(|run| run.trigger != RunTrigger::Test).collect();
    db.set_setting(KEY_LAST_SENT_DATE, &today)?;
    let Some(body) = describe_runs(&runs) else {
        return Ok(false);
    };
    notifier.notify_plain("Your agents today".to_owned(), body);
    Ok(true)
}

/// "5 runs in the last 24 hours: 3 succeeded, 1 failed, 1 waiting for you", or
/// `None` when nothing ran.
fn describe_runs(runs: &[Run]) -> Option<String> {
    if runs.is_empty() {
        return None;
    }
    let count = |statuses: &[RunStatus]| runs.iter().filter(|run| statuses.contains(&run.status)).count();
    let parts: Vec<String> = [
        (count(&[RunStatus::Succeeded]), "succeeded"),
        (count(&[RunStatus::Failed]), "failed"),
        (count(&[RunStatus::Paused]), "waiting for you"),
        (count(&[RunStatus::Running]), "still running"),
        (count(&[RunStatus::Aborted]), "stopped"),
    ]
    .into_iter()
    .filter(|(status_count, _)| *status_count > 0)
    .map(|(status_count, label)| format!("{status_count} {label}"))
    .collect();
    let runs_text = if runs.len() == 1 { "1 run".to_owned() } else { format!("{} runs", runs.len()) };
    Some(format!("{runs_text} in the last 24 hours: {}", parts.join(", ")))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::FixedOffset;

    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    #[derive(Debug, Default)]
    struct RecordingNotifier {
        shown: Mutex<Vec<(String, String)>>,
    }

    impl PlainNotifier for RecordingNotifier {
        fn notify_plain(&self, title: String, body: String) {
            self.shown.lock().unwrap().push((title, body));
        }
    }

    fn jakarta_time(hour: u32) -> DateTime<FixedOffset> {
        let jakarta = FixedOffset::east_opt(7 * 3600).unwrap();
        let today = Utc::now().with_timezone(&jakarta).date_naive();
        jakarta.from_local_datetime(&today.and_hms_opt(hour, 30, 0).unwrap()).unwrap()
    }

    fn database_with_runs() -> Database {
        let db = Database::open_in_memory().unwrap();
        let agent = db
            .create_agent(NewAgent {
                name: "Morning email digest".into(),
                kind: AgentKind::Task,
                description: String::new(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        let succeeded = db.insert_run(&agent.id, 1, RunTrigger::Schedule).unwrap();
        db.finish_run(&succeeded.id, RunStatus::Succeeded, None, None).unwrap();
        let failed = db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap();
        db.finish_run(&failed.id, RunStatus::Failed, None, Some("offline")).unwrap();
        let test_run = db.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        db.finish_run(&test_run.id, RunStatus::Failed, None, None).unwrap();
        db
    }

    fn enable(db: &Database) {
        AppSettings { notify_daily_summary: true, ..AppSettings::default() }.save(db).unwrap();
    }

    #[test]
    fn sends_once_a_day_after_six_pm_when_enabled() {
        let db = database_with_runs();
        let notifier = RecordingNotifier::default();
        assert!(!send_if_due(&db, &notifier, jakarta_time(19)).unwrap(), "off by default");

        enable(&db);
        assert!(!send_if_due(&db, &notifier, jakarta_time(17)).unwrap(), "not before 18:00");
        assert!(send_if_due(&db, &notifier, jakarta_time(18)).unwrap());
        assert!(!send_if_due(&db, &notifier, jakarta_time(21)).unwrap(), "only once a day");

        let shown = notifier.shown.lock().unwrap().clone();
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].0, "Your agents today");
        assert_eq!(shown[0].1, "2 runs in the last 24 hours: 1 succeeded, 1 failed", "test runs are left out");
    }

    #[test]
    fn a_day_without_runs_sends_nothing() {
        let db = Database::open_in_memory().unwrap();
        enable(&db);
        let notifier = RecordingNotifier::default();
        assert!(!send_if_due(&db, &notifier, jakarta_time(18)).unwrap());
        assert!(notifier.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn nothing_ran_means_no_text() {
        assert_eq!(describe_runs(&[]), None);
    }
}
