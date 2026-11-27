//! Runs and trusted lookup hosts: a lookup that only reads because its host is
//! trusted refuses to run while the host is not trusted, and such runs follow no redirects.

use super::*;
use crate::flow::{self, test_fixtures, TrustedHosts};

fn weather_trusted() -> TrustedHosts {
    TrustedHosts::from_entries([test_fixtures::WEATHER_HOST])
}

fn build(harness: &Harness, flow_yaml: &str, trusted_hosts: &TrustedHosts) -> AppResult<graphrt_core::Engine> {
    preparation::build_engine(
        flow_yaml,
        trusted_hosts,
        &harness.credentials,
        &harness.db,
        &*harness.runs.model_source,
        graphrt_core::tool::ToolRegistry::new(),
        None,
    )
}

#[tokio::test]
async fn a_run_refuses_a_lookup_on_a_host_the_agent_does_not_trust() {
    let harness = harness_with_answers(&[]);
    let agent = create_agent(&harness.db, &test_fixtures::trusted_weather_lookup());

    let refused = harness.runs.start_run(&agent.id, RunTrigger::Manual, json!({"note": "Lampung"})).await;

    match refused {
        Err(AppError::InvalidInput(message)) => {
            assert!(message.contains("Look up the weather"), "{message}");
            assert!(message.contains("trust api.open-meteo.com for lookups"), "{message}");
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty(), "no run is recorded");
}

#[test]
fn a_trusted_lookup_builds_once_its_host_is_trusted() {
    let harness = harness_with_answers(&[]);
    let lookup = test_fixtures::trusted_weather_lookup();
    assert!(matches!(build(&harness, &lookup, &TrustedHosts::none()), Err(AppError::InvalidInput(_))));
    assert!(build(&harness, &lookup, &weather_trusted()).is_ok());
}

#[test]
fn a_chatbot_lookup_runs_on_a_trusted_host() {
    let harness = harness_with_answers(&[]);
    let chatbot = test_fixtures::chatbot_weather_lookup();
    let prepare = |trusted_hosts: &TrustedHosts| {
        prepare_engine_and_env(
            &chatbot,
            trusted_hosts,
            &harness.credentials,
            &harness.db,
            &*harness.runs.model_source,
            graphrt_core::tool::ToolRegistry::new(),
            None,
        )
    };
    assert!(matches!(prepare(&TrustedHosts::none()), Err(AppError::InvalidInput(_))));
    assert!(prepare(&weather_trusted()).is_ok());
}

#[test]
fn runs_with_a_trusted_lookup_follow_no_redirects() {
    let lookup = flow::compile_flow(&test_fixtures::trusted_weather_lookup()).unwrap();
    assert_eq!(preparation::egress_policy(&lookup, &weather_trusted()).max_redirects, 0);

    let default_redirects = graphrt_http::EgressPolicy::default().max_redirects;
    assert!(default_redirects > 0);
    let plain_read =
        flow::compile_flow(&test_fixtures::weather_lookup("get", "https://api.open-meteo.com/v1")).unwrap();
    assert_eq!(preparation::egress_policy(&plain_read, &weather_trusted()).max_redirects, default_redirects);
    let simple = flow::compile_flow(SIMPLE_ANSWER).unwrap();
    assert_eq!(preparation::egress_policy(&simple, &TrustedHosts::none()).max_redirects, default_redirects);
}
