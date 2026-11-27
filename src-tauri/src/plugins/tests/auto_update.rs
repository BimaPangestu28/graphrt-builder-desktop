//! Automatic plugin updates: only updates asking for nothing more, never while
//! runs are active, only when switched on, and remembered for Home.

use super::*;
use crate::desktop::app_settings::AppSettings;
use crate::plugins::auto_update::{
    plan_updates, record_auto_updates, AutoUpdateOutcome, PluginVersionChange, HISTORY_LIMIT, RETRY_INTERVAL,
};
use crate::storage::models::{NewAgent, RunTrigger};

const EXTRA_SETTING: &str = "FIXTURE_ECHO_EXTRA";

/// The fixture tarball at `version`, optionally asking for one more setting.
fn tarball_at(version: &str, asks_for_extra_setting: bool) -> Vec<u8> {
    let mut files = fixture_files();
    let manifest = String::from_utf8(files[0].1.clone()).unwrap();
    let mut manifest = manifest.replace("\"version\": \"1.0.0\"", &format!("\"version\": \"{version}\""));
    if asks_for_extra_setting {
        manifest = manifest.replace(
            "\"env\": [\"FIXTURE_ECHO_TOKEN\"]",
            &format!("\"env\": [\"FIXTURE_ECHO_TOKEN\", \"{EXTRA_SETTING}\"]"),
        );
    }
    files[0].1 = manifest.into_bytes();
    tarball(&files, &[])
}

impl Fixture {
    /// Serves `tarball` with a catalog whose entry says it asks for `catalog_env`.
    fn publish_with_env(&self, version: &str, tarball: Vec<u8>, catalog_env: &[&str]) {
        let sha = super::super::archive::sha256_hex(&tarball);
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&catalog_json(version, TARBALL_URL, &sha, tarball.len())).unwrap();
        catalog["plugins"][0]["permissions"]["env"] = serde_json::json!(catalog_env);
        self.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
        self.downloader.serve(TARBALL_URL, tarball);
    }

    /// Like [`Fixture::publish_with_env`] for a `source: community` catalog entry.
    fn publish_community(&self, version: &str, tarball: Vec<u8>) {
        let sha = super::super::archive::sha256_hex(&tarball);
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&catalog_json(version, TARBALL_URL, &sha, tarball.len())).unwrap();
        catalog["plugins"][0]["source"] = "community".into();
        self.downloader.serve(CATALOG_URL, serde_json::to_vec(&catalog).unwrap());
        self.downloader.serve(TARBALL_URL, tarball);
    }

    fn set_auto_update(&self, enabled: bool) {
        AppSettings { auto_update_plugins: enabled, ..AppSettings::default() }.save(&self.db).unwrap();
    }

    fn start_a_run(&self) -> String {
        let agent = self
            .db
            .create_agent(NewAgent {
                name: "Echo".into(),
                kind: crate::storage::models::AgentKind::Task,
                description: "Echo".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        self.db.insert_run(&agent.id, 1, RunTrigger::Manual).unwrap().id
    }

    fn progress_event_count(&self) -> usize {
        self.events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, PluginEvent::InstallProgress { .. }))
            .count()
    }

    fn plugins_changed_count(&self) -> usize {
        self.events.0.lock().unwrap().iter().filter(|event| matches!(event, PluginEvent::PluginsChanged)).count()
    }
}

/// The echo plugin installed at 1.0.0 and trusted.
async fn trusted_fixture() -> Fixture {
    let fixture = installed_fixture().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    fixture
}

#[tokio::test]
async fn the_plan_holds_back_updates_asking_for_more_permissions() {
    let fixture = installed_fixture().await;
    let installed = fixture.service.snapshot().plugins.clone();

    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);
    let same_permissions = fixture.service.catalog(true).await.unwrap();
    assert!(!same_permissions.plugins[0].update_needs_approval);
    let plan = plan_updates(&fixture.service.cached_catalog().unwrap(), &installed, APP_VERSION);
    assert_eq!(plan.ready.len(), 1);
    assert_eq!(plan.ready[0].change.from_version, "1.0.0");
    assert_eq!(plan.ready[0].change.to_version, "1.1.0");
    assert!(plan.needs_approval.is_empty());

    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", true), &["FIXTURE_ECHO_TOKEN", EXTRA_SETTING]);
    let more_permissions = fixture.service.catalog(true).await.unwrap();
    assert!(more_permissions.plugins[0].update_available && more_permissions.plugins[0].update_needs_approval);
    let plan = plan_updates(&fixture.service.cached_catalog().unwrap(), &installed, APP_VERSION);
    assert!(plan.ready.is_empty());
    assert_eq!(plan.needs_approval, vec![PLUGIN.to_owned()]);

    fixture.publish_with_env("1.0.0", good_tarball(), &["FIXTURE_ECHO_TOKEN"]);
    fixture.service.catalog(true).await.unwrap();
    assert_eq!(plan_updates(&fixture.service.cached_catalog().unwrap(), &installed, APP_VERSION), Default::default());
}

#[tokio::test]
async fn an_update_asking_for_nothing_more_installs_keeps_trust_and_is_remembered() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);
    let progress_before = fixture.progress_event_count();
    let changed_before = fixture.plugins_changed_count();

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, stopped_for_runs: false } = outcome else { panic!("{outcome:?}") };
    let expected =
        PluginVersionChange { name: PLUGIN.into(), from_version: "1.0.0".into(), to_version: "1.1.0".into() };
    assert_eq!(summary.updated, vec![expected]);
    let installed = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!(installed.version, "1.1.0");
    assert!(installed.trusted);
    let history = fixture.service.recent_auto_updates().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!((history[0].from_version.as_str(), history[0].to_version.as_str()), ("1.0.0", "1.1.0"));
    assert_eq!(fixture.progress_event_count(), progress_before, "background updates send no install progress");
    assert_eq!(fixture.plugins_changed_count(), changed_before + 1, "the UI is told to refresh");
}

#[tokio::test]
async fn an_update_asking_for_more_permissions_waits_for_the_user() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", true), &["FIXTURE_ECHO_TOKEN", EXTRA_SETTING]);

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, .. } = outcome else { panic!("{outcome:?}") };
    assert!(summary.updated.is_empty());
    assert_eq!(summary.needs_approval, vec![PLUGIN.to_owned()]);
    let installed = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!(installed.version, "1.0.0");
    assert!(installed.trusted);
    assert!(fixture.service.recent_auto_updates().unwrap().is_empty());
}

#[tokio::test]
async fn a_tarball_asking_for_more_than_its_catalog_entry_is_refused_without_touching_trust() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", true), &["FIXTURE_ECHO_TOKEN"]);

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, .. } = outcome else { panic!("{outcome:?}") };
    assert!(summary.updated.is_empty());
    assert_eq!(summary.failed.len(), 1);
    assert!(summary.failed[0].message.contains("asks for more permissions"), "{}", summary.failed[0].message);
    let installed = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!(installed.version, "1.0.0");
    assert!(installed.trusted);
    assert_eq!(fixture.plugin_folder_entries(), vec![PLUGIN.to_owned()]);
}

#[tokio::test]
async fn nothing_updates_while_a_run_is_running_or_paused() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);
    let run_id = fixture.start_a_run();

    let running = fixture.service.run_auto_update_cycle().await;
    assert_eq!(running, AutoUpdateOutcome::RunsActive);
    assert_eq!(running.next_check_in(), RETRY_INTERVAL);
    fixture.db.mark_run_paused(&run_id, "{}", &serde_json::json!([])).unwrap();
    assert_eq!(fixture.service.run_auto_update_cycle().await, AutoUpdateOutcome::RunsActive);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");

    fixture.db.finish_run(&run_id, crate::storage::models::RunStatus::Aborted, None, None).unwrap();
    assert!(matches!(fixture.service.run_auto_update_cycle().await, AutoUpdateOutcome::Checked { .. }));
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.1.0");
}

#[tokio::test]
async fn switched_off_nothing_updates() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);
    fixture.set_auto_update(false);

    assert_eq!(fixture.service.run_auto_update_cycle().await, AutoUpdateOutcome::Disabled);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");

    fixture.set_auto_update(true);
    assert!(matches!(fixture.service.run_auto_update_cycle().await, AutoUpdateOutcome::Checked { .. }));
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.1.0");
}

#[tokio::test]
async fn update_all_installs_ready_updates_without_recording_them() {
    let fixture = trusted_fixture().await;
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);
    fixture.service.catalog(true).await.unwrap();
    fixture.start_a_run();

    let summary = fixture.service.update_all_ready().await.unwrap();

    assert_eq!(summary.updated.len(), 1);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.1.0");
    assert!(fixture.service.recent_auto_updates().unwrap().is_empty());
}

#[test]
fn history_keeps_the_newest_updates_first() {
    let database = Database::open_in_memory().unwrap();
    for index in 0..HISTORY_LIMIT + 3 {
        let change = PluginVersionChange {
            name: format!("plugin-{index}"),
            from_version: "1.0.0".into(),
            to_version: "1.0.1".into(),
        };
        record_auto_updates(&database, &[change], &format!("2026-11-20T00:00:{index:02}Z")).unwrap();
    }
    record_auto_updates(&database, &[], "2026-11-21T00:00:00Z").unwrap();
    let history = super::super::auto_update::read_history(&database).unwrap();
    assert_eq!(history.len(), HISTORY_LIMIT);
    assert_eq!(history[0].name, format!("plugin-{}", HISTORY_LIMIT + 2));
    let json = serde_json::to_value(&history[0]).unwrap();
    assert!(json.get("fromVersion").is_some() && json.get("updatedAt").is_some());
}

#[tokio::test]
async fn community_updates_wait_for_the_user_and_update_all_still_offers_them() {
    let fixture = Fixture::new();
    fixture.publish_community("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    trust(&fixture.service, PLUGIN).await.unwrap();
    // Same permissions as the installed version: an official plugin would update by itself.
    fixture.publish_community("1.1.0", tarball_at("1.1.0", false));

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, .. } = outcome else { panic!("{outcome:?}") };
    assert!(summary.updated.is_empty() && summary.failed.is_empty(), "{summary:?}");
    assert_eq!(summary.needs_approval, vec![PLUGIN.to_owned()]);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");
    assert!(fixture.service.recent_auto_updates().unwrap().is_empty());
    let entry = fixture.service.catalog(false).await.unwrap().plugins.remove(0);
    assert!(entry.update_available, "listed as an available update");

    let summary = fixture.service.update_all_ready().await.unwrap();

    assert_eq!(summary.updated.len(), 1, "{summary:?}");
    let installed = fixture.service.installed(PLUGIN).unwrap();
    assert_eq!(installed.version, "1.1.0");
    assert!(installed.trusted, "asked for nothing more, so trust stays");
}

#[tokio::test]
async fn a_plugin_installed_as_community_waits_even_if_the_catalog_stops_saying_so() {
    let fixture = Fixture::new();
    fixture.publish_community("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    fixture.publish_with_env("1.1.0", tarball_at("1.1.0", false), &["FIXTURE_ECHO_TOKEN"]);

    let outcome = fixture.service.run_auto_update_cycle().await;

    let AutoUpdateOutcome::Checked { summary, .. } = outcome else { panic!("{outcome:?}") };
    assert_eq!(summary.needs_approval, vec![PLUGIN.to_owned()]);
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");
}

#[tokio::test]
async fn update_all_keeps_the_permission_check_for_community_plugins() {
    let fixture = Fixture::new();
    fixture.publish_community("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    // The entry understates its tarball: Update all must refuse it like any other update.
    let tarball = tarball_at("1.1.0", true);
    fixture.publish_community("1.1.0", tarball);
    fixture.service.catalog(true).await.unwrap();

    let summary = fixture.service.update_all_ready().await.unwrap();

    assert!(summary.updated.is_empty());
    assert_eq!(summary.failed.len(), 1, "{summary:?}");
    assert_eq!(fixture.service.installed(PLUGIN).unwrap().version, "1.0.0");
}
