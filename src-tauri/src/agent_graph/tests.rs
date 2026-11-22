use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::library::{self, LibrarySources, NodeKindGroup};
use super::*;
use crate::storage::models::{AgentKind, BuilderMessageRole, NewAgent};
use crate::storage::node_layouts::NodeLayout;

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
const MAPS_WHATSAPP_OUTREACH: &str = include_str!("../../fixtures/flows/maps_whatsapp_outreach.yaml");
const INVALID_REFERENCE: &str = include_str!("../../fixtures/flows/invalid_reference.yaml");
const ALL_FIXTURES: &[(&str, &str)] = &[
    ("simple_answer", SIMPLE_ANSWER),
    ("approval_loop", APPROVAL_LOOP),
    ("maps_whatsapp_outreach", MAPS_WHATSAPP_OUTREACH),
    ("invalid_reference", INVALID_REFERENCE),
];

/// The draft registry with the maps / WhatsApp catalog plugins as placeholders.
async fn maps_catalog_registry() -> Registry {
    let _lock = crate::plugins::tests::ACTIVE_SNAPSHOT_LOCK.lock().await;
    crate::plugins::active::publish_catalog(Some(Arc::new(crate::plugins::tests::maps_whatsapp_catalog())));
    let registry = flow::draft_node_registry();
    crate::plugins::active::publish_catalog(None);
    registry
}

fn source(version: i64) -> GraphSource<'static> {
    GraphSource { agent_id: "agent", version, latest_version: version }
}

fn graph_of(flow_yaml: &str, registry: &Registry) -> AgentGraph {
    graph_from_yaml(source(1), flow_yaml, &GraphContext::new(registry))
}

fn node<'a>(graph: &'a AgentGraph, node_id: &str) -> &'a GraphNodeView {
    graph.nodes.iter().find(|node| node.id == node_id).unwrap_or_else(|| panic!("no node {node_id}"))
}

fn output_ids(node: &GraphNodeView) -> Vec<&str> {
    node.ports.outputs.iter().map(|port| port.id.as_str()).collect()
}

fn problem_codes_of(graph: &AgentGraph) -> Vec<&str> {
    graph.problems.iter().map(|problem| problem.code.as_str()).collect()
}

fn create_agent(db: &Database, flow_yaml: &str) -> String {
    let new_agent = NewAgent {
        name: "Nodes".into(),
        kind: AgentKind::Task,
        description: "Edit me".into(),
        flow_yaml: flow_yaml.into(),
    };
    db.create_agent(new_agent).unwrap().id
}

fn edit_of(graph: &AgentGraph) -> GraphEdit {
    GraphEdit::from(graph)
}

fn node_edit<'a>(edit: &'a mut GraphEdit, node_id: &str) -> &'a mut NodeEdit {
    edit.nodes.iter_mut().find(|node| node.id == node_id).unwrap()
}

// ---- Round trips ----

#[tokio::test]
async fn every_fixture_round_trips_through_an_unchanged_edit() {
    let registry = maps_catalog_registry().await;
    for (name, flow_yaml) in ALL_FIXTURES {
        let original = document::EditableDocument::parse(flow_yaml).unwrap();
        let graph = graph_of(flow_yaml, &registry);
        let edited = original.apply_edit(&edit_of(&graph)).unwrap();
        let written = original.to_yaml(&edited).unwrap();
        let reread =
            document::EditableDocument::parse(&written).unwrap_or_else(|error| panic!("{name}: {error}\n{written}"));

        assert_eq!(
            original.workflow.canonical_graph_json().unwrap(),
            reread.workflow.canonical_graph_json().unwrap(),
            "{name}: nodes and edges changed\n{written}"
        );
        assert_eq!(original.workflow.name, reread.workflow.name, "{name}");
        assert_eq!(original.workflow.description, reread.workflow.description, "{name}");
        assert_eq!(original.workflow.version, reread.workflow.version, "{name}");
        assert_eq!(
            serde_json::to_value(&original.workflow.env).unwrap(),
            serde_json::to_value(&reread.workflow.env).unwrap(),
            "{name}: env changed"
        );
        assert!(written.starts_with('#'), "{name}: the leading comment block is kept");
        let rewritten = reread.to_yaml(&reread.apply_edit(&edit_of(&graph_of(&written, &registry))).unwrap()).unwrap();
        assert_eq!(written, rewritten, "{name}: writing is stable");
        let graph_again = graph_of(&written, &registry);
        assert_eq!(graph.problems, graph_again.problems, "{name}: same validation after the round trip");
    }
}

#[test]
fn unknown_keys_are_kept_at_every_level() {
    let flow_yaml = "\
version: \"1\"
name: extra
x-owner: { team: growth }
graph:
  layout_hint: compact
  nodes:
    - id: start
      type: start
      variables: []
    - id: ask
      type: llm
      title: Ask
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template: [{ role: user, text: 'yes' }]
      future_option: { nested: [1, 2.5, true, null, \"no\"] }
      retry: { max_retries: 2, interval_ms: 500, backoff: 2.0 }
      on_error: { strategy: default-value, values: { text: fallback } }
    - id: end
      type: end
      outputs: []
  edges:
    - { source: start, target: ask, id: first }
    - { source: ask, target: end }
";
    let registry = flow::builtin_node_registry();
    let document = document::EditableDocument::parse(flow_yaml).unwrap();
    let written = document.to_yaml(&document.apply_edit(&edit_of(&graph_of(flow_yaml, &registry))).unwrap()).unwrap();
    let raw: serde_json::Value = serde_saphyr::from_str(&written).unwrap();

    let position = |needle: &str| written.find(needle).unwrap_or_else(|| panic!("no {needle} in\n{written}"));
    assert!(
        position("model:") < position("prompt_template:") && position("prompt_template:") < position("future_option:"),
        "config keys keep their order"
    );
    assert_eq!(raw["x-owner"]["team"], "growth");
    assert_eq!(raw["graph"]["layout_hint"], "compact");
    let ask = &raw["graph"]["nodes"][1];
    assert_eq!(ask["future_option"], serde_json::json!({ "nested": [1, 2.5, true, null, "no"] }));
    assert_eq!(ask["prompt_template"][0]["text"], "yes", "strings that look like booleans stay strings");
    assert_eq!(ask["retry"]["max_retries"], 2);
    assert_eq!(ask["on_error"], serde_json::json!({ "strategy": "default-value", "values": { "text": "fallback" } }));
    assert_eq!(raw["graph"]["edges"][0], serde_json::json!({ "source": "start", "target": "ask", "id": "first" }));
    assert_eq!(raw["graph"]["edges"][1], serde_json::json!({ "source": "ask", "target": "end" }));
}

// ---- The graph model ----

#[tokio::test]
async fn the_maps_fixture_becomes_a_graph_with_ports_containers_and_inputs() {
    let registry = maps_catalog_registry().await;
    let graph = graph_of(MAPS_WHATSAPP_OUTREACH, &registry);

    assert_eq!(graph.name.as_deref(), Some("maps-whatsapp-outreach"));
    let inputs: Vec<&str> = graph.inputs.iter().map(|input| input.name.as_str()).collect();
    assert_eq!(inputs, ["area", "business_type", "offer", "max_results"]);
    assert!(graph.problems.iter().all(|problem| problem.severity == ProblemSeverity::Warning), "{:?}", graph.problems);

    let approval = node(&graph, "approve_message");
    assert_eq!(output_ids(approval), ["send", "skip"]);
    assert_eq!(approval.ports.outputs[0].label, "Send");
    assert!(approval.needs_approval);
    assert_eq!(approval.parent.as_deref(), Some("each_place"));

    let each_place = node(&graph, "each_place");
    assert!(each_place.container && !each_place.hidden);
    assert_eq!(each_place.display_title, "For each business");
    let marker = node(&graph, "each_place_start");
    assert!(marker.hidden && marker.ports.inputs.is_empty());

    let start = node(&graph, "start");
    assert!(start.ports.inputs.is_empty());
    assert_eq!(start.display_title, "Start");
    assert!(node(&graph, "end").ports.outputs.is_empty());

    let send = node(&graph, "send_message");
    assert_eq!(send.plugin.as_deref(), Some("whatsapp-web"));
    assert!(send.sends_data);
    let search = node(&graph, "search_maps");
    assert_eq!(search.detail, "‹business type› in ‹area›", "the readable query excerpt");
    assert_eq!(search.config["query"], "{{#start.business_type#}} in {{#start.area#}}");

    let send_edge = graph.edges.iter().find(|edge| edge.target == "send_message").unwrap();
    assert_eq!((send_edge.source_handle.as_str(), send_edge.unused), ("send", false));
    assert_eq!(send_edge.id, "approve_message-send_message-4");
    assert_eq!(send_edge.document_id, None);
    let plain_edge = graph.edges.iter().find(|edge| edge.source == "start").unwrap();
    assert_eq!(plain_edge.source_handle, "source");
}

#[test]
fn a_plugin_step_without_its_plugin_is_flagged_not_installed() {
    let registry = flow::builtin_node_registry();
    let runnable = registry_kinds(&registry);
    let mut context = GraphContext::new(&registry);
    context.validation.runnable_kinds = Some(&runnable);
    let graph = graph_from_yaml(source(1), MAPS_WHATSAPP_OUTREACH, &context);
    // Without the catalog the plugin kinds do not compile at all.
    assert!(problem_codes_of(&graph).contains(&problem_codes::NODE_CONFIG), "{:?}", graph.problems);
    assert!(problem_codes_of(&graph).contains(&problem_codes::PLUGIN_NOT_INSTALLED));
    let not_installed: Vec<&str> = graph
        .problems
        .iter()
        .filter(|problem| problem.code == problem_codes::PLUGIN_NOT_INSTALLED)
        .filter_map(|problem| problem.node_id.as_deref())
        .collect();
    assert_eq!(not_installed, ["search_maps", "send_message"]);
}

#[test]
fn the_error_exit_follows_on_error_and_stale_error_arrows_are_flagged() {
    let registry = flow::builtin_node_registry();
    let with_error_path = SIMPLE_ANSWER.replace(
        "      title: Answer the question\n",
        "      title: Answer the question\n      on_error: { strategy: fail-branch }\n",
    );
    let graph = graph_of(&with_error_path, &registry);
    assert_eq!(output_ids(node(&graph, "answer_question")), ["source", "fail-branch"]);
    assert_eq!(node(&graph, "answer_question").on_error.strategy, OnErrorStrategy::FailBranch);

    let stale_arrow = SIMPLE_ANSWER.replace(
        "    - { source: reply, target: end }\n",
        "    - { source: reply, target: end }\n    - { source: answer_question, target: end, handle: fail-branch }\n",
    );
    let graph = graph_of(&stale_arrow, &registry);
    let stale = graph.edges.iter().find(|edge| edge.source_handle == "fail-branch").unwrap();
    assert!(stale.unused);
    let problem = graph.problems.iter().find(|problem| problem.code == problem_codes::UNUSED_EDGE).unwrap();
    assert_eq!(problem.edge_id.as_deref(), Some(stale.id.as_str()));
    assert_eq!(problem.severity, ProblemSeverity::Warning);
}

#[test]
fn compile_errors_and_rule_problems_are_pinned_to_their_nodes() {
    let registry = flow::builtin_node_registry();
    let graph = graph_of(INVALID_REFERENCE, &registry);
    let unknown = graph.problems.iter().find(|problem| problem.code == problem_codes::UNKNOWN_REFERENCE).unwrap();
    assert_eq!(unknown.node_id.as_deref(), Some("summarize"));
    assert_eq!(unknown.severity, ProblemSeverity::Error);
    assert_eq!(graph.nodes.len(), 3, "a document that does not compile still shows its nodes");

    let without_approval = APPROVAL_LOOP
        .replace(
            "    - { source: draft_message, target: approve_message }\n",
            "    - { source: draft_message, target: send_message }\n",
        )
        .replace("    - { source: approve_message, target: send_message, handle: send }\n", "");
    let graph = graph_of(&without_approval, &registry);
    let unapproved =
        graph.problems.iter().find(|problem| problem.code == problem_codes::SEND_WITHOUT_APPROVAL).unwrap();
    assert_eq!(unapproved.node_id.as_deref(), Some("send_message"));

    let placeholder = SIMPLE_ANSWER.replace(
        "    - id: reply\n",
        "    - id: notify\n      type: http-request\n      url: https://api.example.com/hook\n\n    - id: reply\n",
    );
    let graph = graph_of(&placeholder, &registry);
    let problem = graph.problems.iter().find(|problem| problem.code == problem_codes::PLACEHOLDER_ADDRESS).unwrap();
    assert_eq!(problem.node_id.as_deref(), Some("notify"));
    assert!(problem_codes_of(&graph).contains(&problem_codes::UNREACHABLE), "notify has no arrow in");
}

#[test]
fn model_providers_that_are_not_set_up_are_errors() {
    let registry = flow::builtin_node_registry();
    let providers = vec!["anthropic".to_owned()];
    let mut context = GraphContext::new(&registry);
    context.validation.available_providers = Some(&providers);
    let graph = graph_from_yaml(source(1), SIMPLE_ANSWER, &context);
    let problem =
        graph.problems.iter().find(|problem| problem.code == problem_codes::MODEL_PROVIDER_NOT_SET_UP).unwrap();
    assert_eq!(problem.node_id.as_deref(), Some("answer_question"));
}

#[test]
fn steps_a_local_cli_cannot_run_are_errors() {
    let registry = flow::builtin_node_registry();
    let cli_flow = SIMPLE_ANSWER.replace(
        "      model:\n        provider: openai\n        name: gpt-4o-mini\n",
        "      vision: { enabled: true }\n      model:\n        provider: claude-code-cli\n        name: default\n",
    );
    let graph = graph_of(&cli_flow, &registry);
    let problem = graph.problems.iter().find(|problem| problem.code == problem_codes::MODEL_CAPABILITY).unwrap();
    assert_eq!(problem.node_id.as_deref(), Some("answer_question"));
    assert!(problem.message.contains("Claude Code (on this computer), which can't read images"), "{}", problem.message);
}

#[test]
fn an_unreadable_document_gives_an_empty_graph_with_the_reason() {
    let registry = flow::builtin_node_registry();
    let graph = graph_of("graph: [unclosed", &registry);
    assert!(graph.nodes.is_empty());
    assert_eq!(problem_codes_of(&graph), [problem_codes::UNREADABLE_DOCUMENT]);
}

// ---- Saving ----

#[test]
fn a_saved_edit_is_a_new_version_with_a_chat_entry() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let graph = load_agent_graph(&db, &agent_id, None, &context).unwrap();
    let mut edit = edit_of(&graph);
    node_edit(&mut edit, "answer_question").title = Some("Answer briefly".into());
    node_edit(&mut edit, "answer_question").retry = RetryView { max_retries: 2, interval_ms: 2000, backoff: 2.0 };

    let result = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();

    assert!(result.saved);
    assert_eq!((result.version_before, result.version_after), (1, 2));
    assert_eq!(result.summary, "Edited in Nodes: Changed Answer briefly");
    assert_eq!(result.changed_step_ids, ["answer_question"]);
    assert_eq!(result.graph.version, 2);
    assert_eq!(node(&result.graph, "answer_question").retry.max_retries, 2);
    let saved = db.get_agent(&agent_id).unwrap();
    assert_eq!(saved.current_version, 2);
    assert!(flow::compile_draft(&saved.flow_yaml).is_ok(), "{}", saved.flow_yaml);
    assert!(saved.flow_yaml.contains("Answer briefly"));
    assert_eq!(db.list_agent_versions(&agent_id).unwrap()[0].change_summary, result.summary);
    let messages = db.list_builder_messages(&agent_id).unwrap();
    let last = messages.last().unwrap();
    assert_eq!(last.role, BuilderMessageRole::Builder);
    assert_eq!(last.text, result.summary);
    assert_eq!((last.version_before, last.version_after), (Some(1), Some(2)));
    assert_eq!(last.changed_step_ids, ["answer_question"]);
}

#[test]
fn the_users_description_is_used_for_the_summary() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    node_edit(&mut edit, "answer_question").timeout_ms = Some(30_000);
    edit.description = Some("set a 30 s timeout on Answer the question".into());
    let result = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();
    assert_eq!(result.summary, "Edited in Nodes: set a 30 s timeout on Answer the question");
}

#[test]
fn secrets_a_step_now_uses_are_declared_in_env_once() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, APPROVAL_LOOP);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    // MAPS_API_KEY is declared already; CRM_TOKEN is new.
    edit.declare_secrets = vec!["CRM_TOKEN".into(), "MAPS_API_KEY".into()];

    let result = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();

    assert!(result.saved);
    let env: Vec<(&str, bool)> = result.graph.env.iter().map(|var| (var.name.as_str(), var.is_secret)).collect();
    assert_eq!(
        env,
        [("MAPS_API_KEY", true), ("WHATSAPP_TOKEN", true), ("WHATSAPP_PHONE_NUMBER_ID", false), ("CRM_TOKEN", true)]
    );
    let saved_yaml = db.get_agent(&agent_id).unwrap().flow_yaml;
    assert_eq!(saved_yaml.matches("CRM_TOKEN").count(), 1, "{saved_yaml}");
    assert!(flow::compile_draft(&saved_yaml).is_ok(), "{saved_yaml}");

    let mut again = edit_of(&result.graph);
    again.declare_secrets = vec!["CRM_TOKEN".into()];
    assert!(
        !save_agent_graph(&db, &agent_id, 2, &again, &context).unwrap().saved,
        "declaring it twice changes nothing"
    );

    let mut invalid = edit_of(&result.graph);
    invalid.declare_secrets = vec!["not a name".into()];
    assert!(matches!(save_agent_graph(&db, &agent_id, 2, &invalid, &context), Err(AppError::InvalidInput(_))));
}

#[test]
fn an_edit_that_changes_nothing_saves_nothing() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    let result = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();
    assert!(!result.saved);
    assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1);
    assert!(db.list_builder_messages(&agent_id).unwrap().is_empty());
}

#[test]
fn an_edit_on_an_old_version_is_a_conflict() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    node_edit(&mut edit, "answer_question").title = Some("Mine".into());
    db.update_agent_flow(&agent_id, &SIMPLE_ANSWER.replace("Answer the question", "The builder's"), "chat").unwrap();

    let error = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap_err();

    assert!(matches!(error, AppError::VersionConflict { base_version: 1, latest_version: 2 }), "{error:?}");
    let serialized = serde_json::to_value(&error).unwrap();
    assert_eq!(serialized["code"], "version_conflict");
    assert_eq!(serialized["details"]["latestVersion"], 2);
    assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 2, "nothing was saved");
}

#[test]
fn saving_waits_while_the_builder_changes_the_agent() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    node_edit(&mut edit, "answer_question").title = Some("Mine".into());

    let guard = edit_lock::begin_builder_edit(&agent_id);
    let busy_state = agent_edit_state(&db, &agent_id).unwrap();
    let busy = save_agent_graph(&db, &agent_id, 1, &edit, &context);
    drop(guard);
    let idle_state = agent_edit_state(&db, &agent_id).unwrap();

    assert!(busy_state.builder_busy && !idle_state.builder_busy);
    assert!(matches!(busy, Err(AppError::BuilderBusy)));
    assert_eq!(serde_json::to_value(busy.unwrap_err()).unwrap()["code"], "builder_busy");
    assert!(save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap().saved, "saves once the builder is done");
}

#[test]
fn an_edit_with_blocking_problems_is_refused_with_them() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, APPROVAL_LOOP);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    edit.edges.retain(|edge| edge.target != "send_message" && edge.target != "approve_message");
    edit.edges.push(EdgeEdit {
        document_id: None,
        source: "draft_message".into(),
        source_handle: None,
        target: "send_message".into(),
    });
    edit.nodes.retain(|node| node.id != "approve_message");

    let error = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap_err();

    let AppError::InvalidGraph(problems) = &error else { panic!("{error:?}") };
    assert!(problems.iter().all(|problem| problem.severity == ProblemSeverity::Error));
    assert!(problems.iter().any(|problem| problem.code == problem_codes::SEND_WITHOUT_APPROVAL
        && problem.node_id.as_deref() == Some("send_message")));
    let serialized = serde_json::to_value(&error).unwrap();
    assert_eq!(serialized["code"], "invalid_graph");
    assert_eq!(serialized["details"]["problems"][0]["code"], "send_without_approval");
    assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1);
}

#[test]
fn validating_an_edit_reports_its_problems_and_saves_nothing() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, APPROVAL_LOOP);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let graph = load_agent_graph(&db, &agent_id, None, &context).unwrap();
    let mut edit = edit_of(&graph);
    edit.nodes.retain(|node| node.id != "approve_message");
    edit.edges.retain(|edge| edge.source != "approve_message" && edge.target != "approve_message");

    let guard = edit_lock::begin_builder_edit(&agent_id);
    let problems = validate_agent_graph(&db, &agent_id, 1, &edit, &context);
    drop(guard);
    let problems = problems.unwrap();

    assert!(problems.iter().any(|problem| problem.severity == ProblemSeverity::Error), "{problems:?}");
    assert!(problems
        .iter()
        .any(|problem| problem.code == problem_codes::UNREACHABLE
            || problem.code == problem_codes::SEND_WITHOUT_APPROVAL));
    assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1, "validating adds no version");
    let unchanged = validate_agent_graph(&db, &agent_id, 1, &edit_of(&graph), &context).unwrap();
    assert_eq!(unchanged, graph.problems);
    assert!(matches!(validate_agent_graph(&db, &agent_id, 9, &edit, &context), Err(AppError::NotFound(_))));
}

#[test]
fn positions_are_copied_forward_and_the_edits_layout_is_saved() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let at = |node_id: &str, x: f64| NodeLayout {
        node_id: node_id.into(),
        x,
        y: 0.0,
        width: None,
        height: None,
        collapsed: false,
    };
    db.save_node_layout(&agent_id, 1, &[at("start", 0.0), at("answer_question", 200.0), at("reply", 400.0)], None)
        .unwrap();

    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    edit.nodes.retain(|node| node.id != "reply");
    edit.edges.retain(|edge| edge.source != "reply" && edge.target != "reply");
    edit.edges.push(EdgeEdit {
        document_id: None,
        source: "answer_question".into(),
        source_handle: None,
        target: "end".into(),
    });
    save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();
    let copied = db.get_node_layout(&agent_id, 2).unwrap();

    let mut moved = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    node_edit(&mut moved, "answer_question").title = Some("Moved".into());
    moved.layout = Some(vec![at("answer_question", 900.0)]);
    save_agent_graph(&db, &agent_id, 2, &moved, &context).unwrap();
    let replaced = db.get_node_layout(&agent_id, 3).unwrap();

    let ids = |set: &crate::storage::node_layouts::NodeLayoutSet| {
        set.nodes.iter().map(|n| n.node_id.clone()).collect::<Vec<_>>()
    };
    assert_eq!(ids(&copied), ["answer_question", "start"], "the removed step's position is not copied");
    assert_eq!(replaced.nodes, vec![at("answer_question", 900.0)]);
}

#[test]
fn a_new_loop_gets_its_hidden_body_marker() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    let mut edit = edit_of(&load_agent_graph(&db, &agent_id, None, &context).unwrap());
    let new_node = |id: &str, kind: &str, parent: Option<&str>, config: serde_json::Value| NodeEdit {
        id: id.into(),
        kind: kind.into(),
        title: None,
        parent: parent.map(str::to_owned),
        config: config.as_object().cloned().unwrap_or_default(),
        on_error: OnErrorView::default(),
        retry: RetryView::default(),
        timeout_ms: None,
    };
    edit.nodes.push(new_node("again", "loop", None, serde_json::json!({ "loop_count": 2 })));
    edit.nodes.push(new_node("polish", "template-transform", Some("again"), serde_json::json!({ "template": "x" })));
    edit.edges.retain(|edge| edge.source != "reply");
    edit.edges.push(EdgeEdit {
        document_id: None,
        source: "reply".into(),
        source_handle: None,
        target: "again".into(),
    });
    edit.edges.push(EdgeEdit { document_id: None, source: "again".into(), source_handle: None, target: "end".into() });

    let result = save_agent_graph(&db, &agent_id, 1, &edit, &context).unwrap();

    let marker = node(&result.graph, "again_start");
    assert_eq!((marker.kind.as_str(), marker.parent.as_deref(), marker.hidden), ("loop-start", Some("again"), true));
    assert!(result.graph.edges.iter().any(|edge| edge.source == "again_start" && edge.target == "polish"));
    assert!(result.summary.starts_with("Edited in Nodes: Added Repeat, Format text"), "{}", result.summary);
}

#[test]
fn unknown_agents_and_versions_are_not_found() {
    let db = Database::open_in_memory().unwrap();
    let registry = flow::builtin_node_registry();
    let context = GraphContext::new(&registry);
    assert!(matches!(load_agent_graph(&db, "ghost", None, &context), Err(AppError::NotFound(_))));
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    assert!(matches!(load_agent_graph(&db, &agent_id, Some(7), &context), Err(AppError::NotFound(_))));
    let edit = GraphEdit {
        nodes: Vec::new(),
        edges: Vec::new(),
        description: None,
        layout: None,
        declare_secrets: Vec::new(),
    };
    assert!(matches!(save_agent_graph(&db, "ghost", 1, &edit, &context), Err(AppError::NotFound(_))));
}

#[test]
fn an_older_version_can_be_read() {
    let db = Database::open_in_memory().unwrap();
    let agent_id = create_agent(&db, SIMPLE_ANSWER);
    db.update_agent_flow(&agent_id, APPROVAL_LOOP, "Replaced").unwrap();
    let registry = flow::builtin_node_registry();
    let graph = load_agent_graph(&db, &agent_id, Some(1), &GraphContext::new(&registry)).unwrap();
    assert_eq!((graph.version, graph.latest_version), (1, 2));
    assert!(graph.nodes.iter().any(|node| node.id == "answer_question"));
}

// ---- Library ----

#[tokio::test]
async fn the_library_lists_builtins_by_app_name_and_catalog_plugin_actions() {
    let registry = maps_catalog_registry().await;
    let runnable = registry_kinds(&flow::builtin_node_registry());
    let display_names = HashMap::from([("whatsapp-web".to_owned(), "WhatsApp Web".to_owned())]);
    let kinds = library::node_library(&LibrarySources {
        registry: &registry,
        runnable_kinds: &runnable,
        plugin_display_names: &display_names,
    });
    let find = |kind: &str| kinds.iter().find(|info| info.kind == kind).unwrap_or_else(|| panic!("no {kind}"));

    let llm = find("llm");
    assert_eq!((llm.display_name.as_str(), llm.group, llm.offered), ("Ask a model", NodeKindGroup::Ai, true));
    assert!(llm.outputs.iter().any(|output| output.name == "text"));
    assert_eq!(find("if-else").ports.exits, library::ExitRule::Dynamic);
    assert_eq!(find("end").ports.exits, library::ExitRule::None);
    assert!(!find("start").ports.has_input);
    assert!(find("iteration").container);
    assert_eq!(find("knowledge-retrieval").group, NodeKindGroup::Ai);
    assert!(!find("iteration-start").offered);
    assert_eq!(find("iteration-start").group, NodeKindGroup::Hidden);
    assert!(!kinds.iter().any(|info| info.kind == "code" || info.kind == "document-extractor"));

    let send = find("whatsapp-web.send_message");
    assert_eq!(send.group, NodeKindGroup::Plugin);
    assert!(send.sends_data && send.offered);
    let plugin = send.plugin.as_ref().unwrap();
    assert_eq!(
        (plugin.name.as_str(), plugin.display_name.as_str(), plugin.installed),
        ("whatsapp-web", "WhatsApp Web", false)
    );
    let search = find("google-maps-scraper.search");
    assert_eq!(search.display_name, "Google Maps search");
    assert_eq!(search.plugin.as_ref().unwrap().display_name, "Google Maps Scraper");
    assert!(search.config_schema["required"].as_array().unwrap().contains(&serde_json::json!("query")));

    let groups: Vec<NodeKindGroup> = kinds.iter().map(|info| info.group).collect();
    let first_plugin = groups.iter().position(|group| *group == NodeKindGroup::Plugin).unwrap();
    assert!(groups[..first_plugin].iter().all(|group| *group != NodeKindGroup::Hidden), "builtins come first");
    let unique: HashSet<&str> = kinds.iter().map(|info| info.kind.as_str()).collect();
    assert_eq!(unique.len(), kinds.len());
}
