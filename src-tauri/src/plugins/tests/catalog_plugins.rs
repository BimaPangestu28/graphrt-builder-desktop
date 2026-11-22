//! Catalog plugins that are not installed: the builder prompt lists them,
//! drafts may use them (placeholder kinds), and requirements report what the
//! user still has to do.

use std::collections::BTreeMap;

use super::*;
use crate::plugins::requirements::{plugin_requirements, PluginRequirement, RequirementSources};

/// Approval, then a catalog-only mail step; also an installed echo step.
const MAIL_FLOW: &str = r#"
version: "1"
name: mail-offer
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: email, type: text-input, required: true }
    - id: echo
      type: fixture-echo.echo
      title: Echo the address
      text: "{{#start.email#}}"
    - id: approve
      type: human-input
      prompt: "Send the offer to {{#start.email#}}?"
      actions:
        - { id: send, title: Send }
        - { id: skip, title: Skip }
    - id: send_offer
      type: fixture-mail.send_mail
      title: Send the offer
      to: "{{#start.email#}}"
      body: Our catering menu
    - id: page
      type: fixture-browser.scrape
      title: Read the menu page
      url: https://shop.test/menu
    - id: end
      type: end
      outputs:
        - { variable: result, value_selector: [send_offer, data] }
  edges:
    - { source: start, target: echo }
    - { source: echo, target: approve }
    - { source: approve, target: send_offer, handle: send }
    - { source: send_offer, target: page }
    - { source: page, target: end }
"#;

async fn fixture_with_catalog() -> Fixture {
    let fixture = Fixture::new();
    fixture.publish_with_extras("1.0.0", good_tarball());
    fixture.service.install(PLUGIN, &echo_catalog_permissions()).await.unwrap();
    fixture
}

fn compile_with(registry: &graphrt_core::Registry, flow: &str) -> Result<graphrt_core::Graph, String> {
    graphrt_core::Graph::from_text(flow, registry).map_err(|error| error.to_string())
}

#[tokio::test]
async fn prompt_guide_lists_catalog_plugins_that_are_not_installed() {
    let fixture = fixture_with_catalog().await;

    let guide = fixture.service.prompt_guide();

    assert!(guide.contains("`fixture-echo.echo` (Echo text)"), "{guide}");
    assert!(!guide.contains("`fixture-echo` (not installed yet)"), "{guide}");
    assert!(guide.contains("Plugin `fixture-mail` (not installed yet)"), "{guide}");
    assert!(guide.contains("`fixture-mail.send_mail` (Send mail): Sends one email."), "{guide}");
    // Required fields first; settings the app configures are left out.
    assert!(guide.contains("Fields (* required): to* (string), body* (string)"), "{guide}");
    assert!(!guide.contains("api_key ("), "{guide}");
    assert!(guide.contains("`fixture-mail.list_inbox` (List inbox): Lists recent emails. Outputs: data, next_cursor."));
    assert!(guide.contains("`fixture-browser.scrape`"), "{guide}");
    assert!(guide.contains("installed or not"), "{guide}");
}

#[tokio::test]
async fn the_saved_catalog_is_used_offline() {
    let fixture = fixture_with_catalog().await;
    fixture.downloader.forget(CATALOG_URL);

    let restarted = fixture.restarted();
    restarted.refresh_catalog_for_builder().await;

    assert!(restarted.prompt_guide().contains("fixture-mail.send_mail"));
    assert!(restarted.draft_node_registry().contains("fixture-mail.send_mail"));
}

#[tokio::test]
async fn without_any_catalog_only_installed_plugins_are_listed() {
    let fixture = installed_fixture().await;
    std::fs::remove_file(fixture.app_data.path().join(super::super::CATALOG_CACHE_FILE_NAME)).unwrap();
    fixture.downloader.forget(CATALOG_URL);

    let restarted = fixture.restarted();
    restarted.refresh_catalog_for_builder().await;

    let guide = restarted.prompt_guide();
    assert!(guide.contains("fixture-echo.echo"), "{guide}");
    assert!(!guide.contains("not installed yet"), "{guide}");
}

#[tokio::test]
async fn drafts_may_use_catalog_kinds_but_runs_may_not() {
    let fixture = fixture_with_catalog().await;
    let draft_registry = fixture.service.draft_node_registry();

    assert!(compile_with(&draft_registry, MAIL_FLOW).is_ok(), "{:?}", compile_with(&draft_registry, MAIL_FLOW).err());
    let run_error = compile_with(&fixture.service.node_registry(), MAIL_FLOW).unwrap_err();
    assert!(run_error.contains("fixture-mail.send_mail"), "{run_error}");
}

#[tokio::test]
async fn catalog_kinds_check_required_fields_and_unknown_kinds_are_rejected() {
    let fixture = fixture_with_catalog().await;
    let registry = fixture.service.draft_node_registry();

    let without_body = MAIL_FLOW.replace("      body: Our catering menu\n", "");
    let missing = compile_with(&registry, &without_body).unwrap_err();
    assert!(missing.contains("`body`"), "{missing}");

    let bad_choice = MAIL_FLOW.replace("body: Our catering menu", "body: hi\n      priority: urgent");
    assert!(compile_with(&registry, &bad_choice).is_err());

    let unknown = MAIL_FLOW.replace("fixture-mail.send_mail", "fixture-mail.format_disk");
    let unknown_error = compile_with(&registry, &unknown).unwrap_err();
    assert!(unknown_error.contains("fixture-mail.format_disk"), "{unknown_error}");
}

#[tokio::test]
async fn the_published_catalog_feeds_summaries_approval_checks_and_missing_plugins() {
    let fixture = fixture_with_catalog().await;
    let _lock = ACTIVE_SNAPSHOT_LOCK.lock().await;
    fixture.service.activate();

    let summary = crate::flow::summarize_flow(MAIL_FLOW);
    let unapproved = crate::flow::find_unapproved_sending_steps(MAIL_FLOW);
    let compiled_for_run = crate::flow::compile_flow(MAIL_FLOW);
    let missing = crate::flow::find_missing_plugins(MAIL_FLOW);
    let guide = crate::plugins::installed_plugins_guide();
    crate::plugins::active::publish(None);
    crate::plugins::active::publish_catalog(None);

    let titles: Vec<String> = summary.unwrap().steps.into_iter().map(|step| step.title).collect();
    assert!(titles.contains(&"Send the offer".to_owned()), "{titles:?}");
    assert!(unapproved.unwrap().is_empty());
    assert!(compiled_for_run.is_err());
    assert_eq!(missing, vec!["fixture-browser".to_owned(), "fixture-mail".to_owned()]);
    assert!(guide.contains("Plugin `fixture-mail` (not installed yet)"), "{guide}");
}

fn requirement<'a>(requirements: &'a [PluginRequirement], name: &str) -> &'a PluginRequirement {
    requirements.iter().find(|requirement| requirement.name == name).unwrap()
}

#[tokio::test]
async fn requirements_report_install_trust_settings_and_browser_state() {
    let fixture = fixture_with_catalog().await;
    let report = fixture.service.requirements(MAIL_FLOW).unwrap();

    let names: Vec<&str> = report.iter().map(|requirement| requirement.name.as_str()).collect();
    assert_eq!(names, vec![PLUGIN, "fixture-mail", "fixture-browser"]);

    let echo = requirement(&report, PLUGIN);
    assert!(echo.installed);
    assert!(!echo.trusted);
    assert!(!echo.trust_not_needed);
    assert_eq!(echo.used_by_steps, vec!["Echo the address".to_owned()]);
    assert_eq!(echo.missing_config, vec!["FIXTURE_ECHO_TOKEN".to_owned()]);
    assert!(echo.needs_browser);
    assert!(!echo.ready);

    let mail = requirement(&report, "fixture-mail");
    assert!(!mail.installed && !mail.ready);
    assert_eq!(mail.description, "Sends and reads mail (test fixture, never installed)");
    assert_eq!(mail.warning.as_deref(), Some("Sending bulk mail may get the account blocked."));
    assert!(mail.permissions.secrets);
    // Browser profile folders come from the app.
    assert_eq!(mail.missing_config, vec!["FIXTURE_MAIL_API_KEY".to_owned()]);
    assert!(mail.browser_ready, "not needed");

    let browser = requirement(&report, "fixture-browser");
    assert!(browser.trust_not_needed);
    assert!(browser.needs_browser);
    assert!(browser.missing_config.is_empty());
    assert_eq!(browser.used_by_steps, vec!["Read the menu page".to_owned()]);
}

#[tokio::test]
async fn an_installed_trusted_configured_plugin_is_ready_once_the_browser_is() {
    let fixture = fixture_with_catalog().await;
    trust(&fixture.service, PLUGIN).await.unwrap();
    fixture.service.set_config(PLUGIN, "FIXTURE_ECHO_TOKEN", "token").await.unwrap();
    let snapshot = fixture.service.snapshot();
    let records = BTreeMap::from([(
        PLUGIN.to_owned(),
        crate::plugins::models::InstallRecord {
            version: "1.0.0".into(),
            needs_browser: true,
            readme_url: None,
            icon_url: None,
            display_name: None,
            ..Default::default()
        },
    )]);
    let catalog = not_installed_catalog();
    // `echo_session`: the echo plugin's account session as the session store reports it
    // (`None`: the plugin has no session, like most plugins).
    let report_with = |browser_ready: bool, echo_session: Option<bool>| {
        let is_ready = move |_: &str| browser_ready;
        let session_linked = move |plugin: &str| if plugin == PLUGIN { echo_session } else { None };
        let sources = RequirementSources {
            installed: &snapshot.plugins,
            install_records: &records,
            catalog: Some(&catalog),
            credentials: &fixture.credentials,
            browser_ready: &is_ready,
            session_linked: &session_linked,
        };
        plugin_requirements(MAIL_FLOW, &sources).unwrap()
    };

    let without_browser = report_with(false, None);
    let with_browser = report_with(true, None);

    let echo = requirement(&without_browser, PLUGIN);
    assert!(echo.trusted && echo.missing_config.is_empty());
    assert!(!echo.browser_ready && !echo.ready);
    assert!(!echo.needs_session && echo.session_linked, "no session needed counts as linked");
    assert!(requirement(&with_browser, PLUGIN).ready);
    // Not installed stays not ready, even with nothing else missing.
    assert!(!requirement(&with_browser, "fixture-browser").ready);
    assert!(requirement(&with_browser, "fixture-browser").browser_ready);

    // A session plugin (whatsapp-web) is ready only once its session is linked.
    let not_linked = report_with(true, Some(false));
    let echo = requirement(&not_linked, PLUGIN);
    assert!(echo.needs_session && !echo.session_linked);
    assert!(echo.browser_ready && echo.trusted && echo.missing_config.is_empty());
    assert!(!echo.ready, "installed, trusted and configured but not linked is not ready");
    let linked = report_with(true, Some(true));
    let echo = requirement(&linked, PLUGIN);
    assert!(echo.needs_session && echo.session_linked && echo.ready);
}

#[tokio::test]
async fn whatsapp_web_needs_a_linked_session_from_the_session_store() {
    let fixture = fixture_with_catalog().await;
    let flow = r#"
version: "1"
name: wa
graph:
  nodes:
    - { id: start, type: start }
    - { id: send, type: whatsapp-web.send_message, title: Send the reminder, phone: "+62 812 3456 789", text: Hi }
  edges:
    - { source: start, target: send }
"#;
    let report = fixture.service.requirements(flow).unwrap();
    let whatsapp = requirement(&report, "whatsapp-web");
    assert!(whatsapp.needs_session && !whatsapp.session_linked, "never checked is not linked");
    assert!(!whatsapp.ready);

    crate::plugins::session::save_session(&fixture.db, "whatsapp-web", crate::plugins::session::SessionState::Linked)
        .unwrap();
    let report = fixture.service.requirements(flow).unwrap();
    assert!(requirement(&report, "whatsapp-web").session_linked);

    crate::plugins::session::record_step_failure(&fixture.db, "whatsapp-web.send_message", "auth_error");
    let report = fixture.service.requirements(flow).unwrap();
    assert!(!requirement(&report, "whatsapp-web").session_linked);
}

#[tokio::test]
async fn flows_without_plugins_need_nothing() {
    let fixture = fixture_with_catalog().await;
    let simple = include_str!("../../../fixtures/flows/simple_answer.yaml");
    assert!(fixture.service.requirements(simple).unwrap().is_empty());
    assert!(fixture.service.requirements("not: [a workflow").unwrap().is_empty());
}
