//! An agent's abilities reach its runs: a helper agent runs as a child run of the same run,
//! what the owner tells a test run is remembered under the owner, and the spending limit
//! bounds the engine. Only the model is scripted.

use super::*;
use crate::agent_graph::abilities::{set_ability, AbilityChange};
use crate::agent_graph::GraphContext;
use crate::engine::spending::{self, SpendingLimit};
use crate::memory::{MemoryService, APP_USER};

/// A helper that needs no model: it answers with what it was asked.
const ECHO_HELPER: &str = r#"
version: "1"
name: stock-checker
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: text-input, required: true }] }
    - { id: end, type: end, outputs: [{ variable: text, value_selector: [start, question], value_type: string }] }
  edges:
    - { source: start, target: end }
"#;

const LEAD: &str = r#"
version: "1"
name: shop-assistant
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: paragraph, required: true }] }
    - id: assistant
      type: agent
      title: Answer the customer
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.question#}}"
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [assistant, text], value_type: string }] }
  edges:
    - { source: start, target: assistant }
    - { source: assistant, target: end }
"#;

fn progress_names(harness: &Harness, run_id: &str) -> Vec<String> {
    harness
        .db
        .list_run_events(run_id)
        .unwrap()
        .iter()
        .filter(|record| record.event["type"] == "node_progress")
        .filter_map(|record| record.event["name"].as_str().map(str::to_owned))
        .collect()
}

// One test on purpose: the memory store runs use is published for the whole process
// (`memory::active`), like the skill and lesson stores in `skills_and_learning`.
#[tokio::test]
async fn a_test_run_asks_its_helper_agent_and_remembers_what_the_owner_said() {
    // The agent remembers what the owner said, asks its helper, then answers.
    let model_script = Arc::new(MockModel::new(Vec::new()));
    let harness = harness_with_model(model_script.clone());
    let helper = harness
        .db
        .create_agent(NewAgent {
            name: "Stock checker".into(),
            kind: AgentKind::Task,
            description: "Checks whether a product is in stock".into(),
            flow_yaml: ECHO_HELPER.into(),
        })
        .unwrap();
    let lead = create_agent(&harness.db, LEAD);
    let registry = crate::flow::draft_node_registry();
    let context = GraphContext::new(&registry);
    let helpers = AbilityChange::Helpers { agent_ids: vec![helper.id.clone()], max_parallel: 2, max_calls: 5 };
    set_ability(&harness.db, &lead.id, &helpers, &context).unwrap();
    set_ability(&harness.db, &lead.id, &AbilityChange::Memory { enabled: true, graph: false }, &context).unwrap();
    let app_data = tempfile::tempdir().unwrap();
    let memory = MemoryService::new(app_data.path(), harness.db.clone());
    memory.activate();
    model_script.push(MockModel::tool_calls(&[(
        "call-1",
        "remember",
        r#"{"text":"Prefers invoices as PDF","kind":"preference"}"#,
    )]));
    model_script.push(MockModel::tool_calls(&[(
        "call-2",
        helper.id.as_str(),
        r#"{"question":"Is the oak table in stock?"}"#,
    )]));
    model_script.push(MockModel::text("The oak table is in stock, and I will send the invoice as PDF."));

    let run = harness
        .runs
        .start_run(
            &lead.id,
            RunTrigger::Test,
            json!({"question": "I prefer invoices as PDF. Is the oak table in stock?"}),
        )
        .await
        .unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let names = progress_names(&harness, &run.id);
    assert!(names.contains(&"memory_saved".to_owned()), "{names:?}");
    assert!(names.contains(&"subagent_finished".to_owned()), "{names:?}");
    // The helper's own steps ran under its frame, in the same run.
    let helper_frame = format!("assistant.{}[0]", helper.id);
    let events = harness.db.list_run_events(&run.id).unwrap();
    assert!(
        events
            .iter()
            .any(|record| record.event["frame"] == helper_frame.as_str() && record.event["type"] == "node_started"),
        "no event of the helper's frame {helper_frame}"
    );
    // The helper's answer reached the lead's model as the tool result.
    let last_request = format!("{:?}", model_script.requests().last().unwrap());
    assert!(last_request.contains("Is the oak table in stock?"), "{last_request}");

    // What the owner said in a test run is kept under the owner, in use at once.
    let notes = memory.notes(&lead.id, Some(APP_USER)).await.unwrap();
    assert_eq!(notes.iter().map(|note| note.text.as_str()).collect::<Vec<_>>(), ["Prefers invoices as PDF"]);
    assert_eq!(notes[0].status, graphrt_core::memory::MemoryStatus::Active);

    // A scheduled run serves nobody in particular: what it saves is only proposed for the
    // agent as a whole, never kept under the owner.
    model_script.push(MockModel::tool_calls(&[(
        "call-3",
        "remember",
        r#"{"text":"The showroom opens at 10 on Saturdays"}"#,
    )]));
    model_script.push(MockModel::text("Noted."));
    let scheduled =
        harness.runs.start_run(&lead.id, RunTrigger::Schedule, json!({"question": "Weekly check"})).await.unwrap();
    wait_for_status(&harness.sink, &scheduled.id, RunStatus::Succeeded).await;
    let owner_notes = memory.notes(&lead.id, Some(APP_USER)).await.unwrap();
    assert_eq!(owner_notes.len(), 1, "nothing new under the owner: {owner_notes:?}");
    let agent_notes = memory.notes(&lead.id, None).await.unwrap();
    assert_eq!(
        agent_notes.iter().map(|note| (note.text.as_str(), note.status)).collect::<Vec<_>>(),
        [("The showroom opens at 10 on Saturdays", graphrt_core::memory::MemoryStatus::Pending)]
    );
    crate::memory::unpublish_for_tests();
}

#[test]
fn the_agents_spending_limit_bounds_its_engine() {
    let harness = harness_with_answers(&[]);
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    spending::save(
        &harness.db,
        &agent.id,
        SpendingLimit { max_total_tokens: Some(20_000), max_cost_micros: Some(50_000) },
    )
    .unwrap();
    let trusted_hosts = crate::flow::TrustedHosts::none();
    let build = |agent_id: Option<&str>| {
        let scope = preparation::RunScope { agent_id, trusted_hosts: &trusted_hosts, files: None };
        preparation::build_engine(
            &agent.flow_yaml,
            &scope,
            &harness.credentials,
            &harness.db,
            &*harness.runs.model_source,
            graphrt_core::tool::ToolRegistry::new(),
        )
        .unwrap()
    };

    let engine = build(Some(&agent.id));
    assert_eq!((engine.limits().max_total_tokens, engine.limits().max_cost_micros), (Some(20_000), Some(50_000)));
    // A workflow that is no agent's (a judge) gets only the app's run limits.
    let judge = build(None);
    assert_eq!((judge.limits().max_total_tokens, judge.limits().max_cost_micros), (None, None));
}

#[tokio::test]
async fn a_run_refuses_to_start_when_a_helper_agent_was_deleted() {
    let harness = harness_with_answers(&["unused"]);
    let helper = create_agent(&harness.db, ECHO_HELPER);
    let lead = create_agent(&harness.db, LEAD);
    let registry = crate::flow::draft_node_registry();
    let helpers = AbilityChange::Helpers { agent_ids: vec![helper.id.clone()], max_parallel: 4, max_calls: 16 };
    set_ability(&harness.db, &lead.id, &helpers, &GraphContext::new(&registry)).unwrap();
    harness.db.delete_agent(&helper.id).unwrap();

    let refused = harness.runs.start_run(&lead.id, RunTrigger::Test, json!({"question": "?"})).await;

    match refused {
        Err(AppError::NotFound(message)) => assert!(message.contains("helper agent"), "{message}"),
        other => panic!("expected NotFound, got {other:?}"),
    }
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty(), "no run is recorded");
}

/// A helper that asks the owner before it answers.
const ASKING_HELPER: &str = r#"
version: "1"
name: order-placer
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: text-input, required: true }] }
    - id: ask
      type: human-input
      prompt: "Place this order? {{#start.question#}}"
      actions:
        - { id: approve, title: Place it }
        - { id: reject, title: Don't }
    - { id: end, type: end, outputs: [{ variable: text, value_selector: [start, question], value_type: string }] }
  edges:
    - { source: start, target: ask }
    - { source: ask, target: end, handle: approve }
"#;

#[tokio::test]
async fn an_approval_inside_a_helper_pauses_the_whole_run_and_resuming_finishes_it() {
    let model = Arc::new(MockModel::new(Vec::new()));
    let harness = harness_with_model(model.clone());
    let helper = create_agent(&harness.db, ASKING_HELPER);
    let lead = create_agent(&harness.db, LEAD);
    let registry = crate::flow::draft_node_registry();
    let helpers = AbilityChange::Helpers { agent_ids: vec![helper.id.clone()], max_parallel: 4, max_calls: 16 };
    set_ability(&harness.db, &lead.id, &helpers, &GraphContext::new(&registry)).unwrap();
    model.push(MockModel::tool_calls(&[("call-1", helper.id.as_str(), r#"{"question":"50 lunch boxes"}"#)]));
    model.push(MockModel::text("The order for 50 lunch boxes is placed."));

    let run =
        harness.runs.start_run(&lead.id, RunTrigger::Test, json!({"question": "Order 50 lunch boxes"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let reasons = harness.db.get_run(&run.id).unwrap().pause_reasons.unwrap();
    let helper_frame = format!("assistant.{}[0]", helper.id);
    let waiting =
        reasons.as_array().unwrap().iter().find(|reason| reason["node_id"] == "ask").expect("the helper's question");
    assert_eq!(waiting["frame"], helper_frame.as_str());
    assert!(waiting.get("expires_at").is_none(), "no deadline taken from the lead's steps");

    harness.runs.resume_run(&run.id, json!({ format!("{helper_frame}/ask"): {"action": "approve"} })).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    let outputs = harness.db.get_run(&run.id).unwrap().outputs.unwrap();
    assert_eq!(outputs["result"], "The order for 50 lunch boxes is placed.");
}

#[test]
fn helpers_of_helpers_are_linked_once_and_a_loop_ends() {
    let harness = harness_with_answers(&[]);
    let registry = crate::flow::draft_node_registry();
    let context = GraphContext::new(&registry);
    let first = create_agent(&harness.db, LEAD);
    let second = create_agent(&harness.db, LEAD);
    let leaf = create_agent(&harness.db, ECHO_HELPER);
    let ask = |agent: &Agent, helpers: Vec<String>| {
        let change = AbilityChange::Helpers { agent_ids: helpers, max_parallel: 4, max_calls: 16 };
        set_ability(&harness.db, &agent.id, &change, &context).unwrap();
    };
    // first -> second -> (leaf, first): a chain with a loop back to the start.
    ask(&second, vec![leaf.id.clone(), first.id.clone()]);
    ask(&first, vec![second.id.clone()]);
    let first = harness.db.get_agent(&first.id).unwrap();

    let engine = harness.runs.engine_for(
        &first,
        &first.flow_yaml,
        &crate::flow::TrustedHosts::none(),
        graphrt_core::tool::ToolRegistry::new(),
    );

    // Every agent of the chain is linked, the loop included, and building stops.
    assert!(engine.is_ok(), "{:?}", engine.err());
}

#[test]
fn a_helper_that_needs_a_file_to_start_is_refused_when_linked() {
    let harness = harness_with_answers(&[]);
    let registry = crate::flow::draft_node_registry();
    let lead = create_agent(&harness.db, LEAD);
    let helper = create_agent(&harness.db, ECHO_HELPER);
    let change = AbilityChange::Helpers { agent_ids: vec![helper.id.clone()], max_parallel: 4, max_calls: 16 };
    set_ability(&harness.db, &lead.id, &change, &GraphContext::new(&registry)).unwrap();
    // The helper is changed afterwards so that it needs a file another agent cannot hand over.
    let needs_file = ECHO_HELPER.replace("type: text-input, required: true", "type: file, required: true");
    harness.db.update_agent_flow_from_version(&helper.id, helper.current_version, &needs_file, "needs a file").unwrap();
    let lead = harness.db.get_agent(&lead.id).unwrap();

    let refused = harness.runs.engine_for(
        &lead,
        &lead.flow_yaml,
        &crate::flow::TrustedHosts::none(),
        graphrt_core::tool::ToolRegistry::new(),
    );

    assert!(matches!(refused, Err(AppError::InvalidInput(message)) if message.contains("cannot be asked for help")));
}

#[tokio::test]
async fn a_paused_helper_is_refused_with_its_name() {
    let harness = harness_with_answers(&["unused"]);
    let registry = crate::flow::draft_node_registry();
    let lead = create_agent(&harness.db, LEAD);
    let helper = create_agent(&harness.db, ECHO_HELPER);
    let change = AbilityChange::Helpers { agent_ids: vec![helper.id.clone()], max_parallel: 4, max_calls: 16 };
    set_ability(&harness.db, &lead.id, &change, &GraphContext::new(&registry)).unwrap();
    harness.db.set_agent_status(&helper.id, AgentStatus::Paused).unwrap();

    let refused = harness.runs.start_run(&lead.id, RunTrigger::Test, json!({"question": "?"})).await;

    assert!(matches!(refused, Err(AppError::InvalidInput(message)) if message.contains("is paused")));
}
