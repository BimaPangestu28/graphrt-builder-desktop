use super::*;

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
const INVALID_REFERENCE: &str = include_str!("../../fixtures/flows/invalid_reference.yaml");

fn step_ids(summary: &FlowSummary) -> Vec<&str> {
    summary.steps.iter().map(|step| step.id.as_str()).collect()
}

fn find_step<'a>(summary: &'a FlowSummary, id: &str) -> &'a FlowStep {
    summary
        .steps
        .iter()
        .find(|step| step.id == id)
        .unwrap_or_else(|| panic!("no step `{id}`"))
}

#[test]
fn valid_fixtures_compile() {
    for fixture in [SIMPLE_ANSWER, APPROVAL_LOOP] {
        compile_flow(fixture).unwrap();
    }
}

#[test]
fn invalid_reference_fixture_fails_with_workflow_error() {
    let error = compile_flow(INVALID_REFERENCE).unwrap_err();
    match error {
        AppError::Workflow(message) => assert!(message.contains("search"), "{message}"),
        other => panic!("expected a workflow error, got {other:?}"),
    }
    assert!(matches!(
        summarize_flow(INVALID_REFERENCE),
        Err(AppError::Workflow(_))
    ));
}

#[test]
fn empty_document_is_rejected_as_invalid_input() {
    for text in ["", "   \n\t", "# just a comment\n"] {
        assert!(
            matches!(compile_flow(text), Err(AppError::InvalidInput(_))),
            "{text:?}"
        );
        assert!(
            matches!(summarize_flow(text), Err(AppError::InvalidInput(_))),
            "{text:?}"
        );
    }
}

#[test]
fn yaml_syntax_error_is_a_readable_workflow_error() {
    let error = compile_flow("version: \"1\"\ngraph: { nodes: [ { id: a\n").unwrap_err();
    match error {
        AppError::Workflow(message) => {
            assert!(message.contains("YAML"), "{message}");
            assert!(!message.is_empty());
        }
        other => panic!("expected a workflow error, got {other:?}"),
    }
}

#[test]
fn unknown_node_type_is_a_workflow_error() {
    let yaml = "version: \"1\"\ngraph:\n  nodes:\n    - { id: start, type: start }\n    - { id: x, type: teleport }\n  edges:\n    - { source: start, target: x }\n";
    assert!(matches!(compile_flow(yaml), Err(AppError::Workflow(_))));
}

#[test]
fn registry_includes_llm_and_http_kinds() {
    let registry = node_registry();
    let kinds: Vec<&str> = registry.kinds().collect();
    for kind in [
        "start",
        "human-input",
        "iteration",
        "llm",
        "agent",
        "http-request",
    ] {
        assert!(kinds.contains(&kind), "missing {kind}");
    }
}

#[test]
fn simple_answer_summary() {
    let summary = summarize_flow(SIMPLE_ANSWER).unwrap();
    assert_eq!(step_ids(&summary), ["answer_question", "reply"]);
    let model_step = find_step(&summary, "answer_question");
    assert_eq!(model_step.title, "Answer the question");
    assert_eq!(model_step.node_type, "llm");
    assert_eq!(model_step.detail, "gpt-4o-mini");
    assert!(!model_step.needs_approval);
    assert_eq!(model_step.depth, 0);
    assert_eq!(find_step(&summary, "reply").title, "Reply");
    assert_eq!(
        summary.inputs,
        [FlowInput {
            name: "question".into(),
            label: "Your question".into(),
            required: true
        }]
    );
    assert_eq!(summary.model_providers, ["openai"]);
}

#[test]
fn approval_loop_steps_follow_execution_order_with_depth() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    assert_eq!(
        step_ids(&summary),
        [
            "find_cafes",
            "each_cafe",
            "draft_message",
            "approve_message",
            "send_message"
        ]
    );
    let depths: Vec<u32> = summary.steps.iter().map(|step| step.depth).collect();
    assert_eq!(depths, [0, 0, 1, 1, 1]);
}

#[test]
fn approval_loop_titles_details_and_approval() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    let find = find_step(&summary, "find_cafes");
    assert_eq!(find.title, "Find cafes on Google Maps");
    assert_eq!(find.detail, "GET example.com");
    let each = find_step(&summary, "each_cafe");
    assert_eq!(each.title, "For each cafe");
    assert_eq!(each.detail, "over find_cafes.json.results");
    let draft = find_step(&summary, "draft_message");
    assert_eq!(draft.title, "Ask a model");
    assert_eq!(draft.detail, "claude-haiku-4-5");
    let approve = find_step(&summary, "approve_message");
    assert_eq!(approve.title, "Ask me before continuing");
    assert!(approve.needs_approval);
    assert!(
        approve.detail.starts_with("Send this message to"),
        "{}",
        approve.detail
    );
    assert!(approve.detail.chars().count() <= 80);
    let send = find_step(&summary, "send_message");
    assert_eq!(send.detail, "POST example.com");
    assert!(!send.needs_approval);
    let approvals = summary
        .steps
        .iter()
        .filter(|step| step.needs_approval)
        .count();
    assert_eq!(approvals, 1);
}

#[test]
fn approval_loop_inputs_and_providers() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    assert_eq!(
        summary.inputs,
        [
            FlowInput {
                name: "area".into(),
                label: "Area to search".into(),
                required: true
            },
            FlowInput {
                name: "offer".into(),
                label: "Offer to send".into(),
                required: true
            },
            FlowInput {
                name: "max_cafes".into(),
                label: "Max cafes".into(),
                required: false
            },
        ]
    );
    assert_eq!(summary.model_providers, ["anthropic"]);
}

#[test]
fn providers_are_unique_and_sorted_and_agent_approval_detected() {
    let yaml = r#"
version: "1"
graph:
  nodes:
    - { id: start, type: start }
    - id: helper
      type: agent
      model: { provider: openai, name: gpt-4o }
      instruction: "Help"
      query: "{{#sys.query#}}"
      require_approval: ["*"]
    - id: second
      type: llm
      model: { provider: anthropic, name: claude-haiku-4-5 }
      prompt_template: [{ role: user, text: "{{#helper.text#}}" }]
    - id: third
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template: [{ role: user, text: "{{#second.text#}}" }]
  edges:
    - { source: start, target: helper }
    - { source: helper, target: second }
    - { source: second, target: third }
"#;
    let summary = summarize_flow(yaml).unwrap();
    assert_eq!(summary.model_providers, ["anthropic", "openai"]);
    assert!(find_step(&summary, "helper").needs_approval);
    assert_eq!(find_step(&summary, "helper").title, "Run an agent");
    assert!(summary.inputs.is_empty());
}

#[test]
fn long_prompts_are_truncated_in_detail() {
    let long_prompt = "word ".repeat(60);
    let yaml = format!(
        "version: \"1\"\ngraph:\n  nodes:\n    - {{ id: start, type: start }}\n    - {{ id: show, type: answer, answer: \"{long_prompt}\" }}\n  edges:\n    - {{ source: start, target: show }}\n"
    );
    let summary = summarize_flow(&yaml).unwrap();
    let detail = &find_step(&summary, "show").detail;
    assert_eq!(detail.chars().count(), 80);
    assert!(detail.ends_with('…'));
}

#[test]
fn format_guide_is_compact_and_covers_key_nodes() {
    let guide = workflow_format_guide();
    assert!(
        guide.lines().count() <= 150,
        "{} lines",
        guide.lines().count()
    );
    for needle in [
        "human-input",
        "http-request",
        "iteration-start",
        "{{#",
        "handle",
        "llm",
    ] {
        assert!(guide.contains(needle), "missing {needle}");
    }
}
