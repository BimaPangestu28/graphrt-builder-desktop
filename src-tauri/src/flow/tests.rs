use super::*;

const SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
const INVALID_REFERENCE: &str = include_str!("../../fixtures/flows/invalid_reference.yaml");

fn step_ids(summary: &FlowSummary) -> Vec<&str> {
    summary.steps.iter().map(|step| step.id.as_str()).collect()
}

fn find_step<'a>(summary: &'a FlowSummary, id: &str) -> &'a FlowStep {
    summary.steps.iter().find(|step| step.id == id).unwrap_or_else(|| panic!("no step `{id}`"))
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
    assert!(matches!(summarize_flow(INVALID_REFERENCE), Err(AppError::Workflow(_))));
}

#[test]
fn empty_document_is_rejected_as_invalid_input() {
    for text in ["", "   \n\t", "# just a comment\n"] {
        assert!(matches!(compile_flow(text), Err(AppError::InvalidInput(_))), "{text:?}");
        assert!(matches!(summarize_flow(text), Err(AppError::InvalidInput(_))), "{text:?}");
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
    for kind in ["start", "human-input", "iteration", "llm", "agent", "http-request"] {
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
        [FlowInput { input_type: "paragraph".into(), ..FlowInput::text("question", "Your question", true) }]
    );
    assert_eq!(summary.model_providers, ["openai"]);
}

#[test]
fn approval_loop_steps_follow_execution_order_with_depth() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    assert_eq!(
        step_ids(&summary),
        [
            "confirm_search",
            "find_cafes",
            "each_cafe",
            "draft_message",
            "approve_message",
            "send_message",
            "write_report"
        ]
    );
    let depths: Vec<u32> = summary.steps.iter().map(|step| step.depth).collect();
    assert_eq!(depths, [0, 0, 0, 1, 1, 1, 0]);
}

#[test]
fn approval_loop_titles_details_and_approval() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    let find = find_step(&summary, "find_cafes");
    assert_eq!(find.title, "Find cafes on Google Maps");
    assert_eq!(find.detail, "GET maps.googleapis.com");
    let each = find_step(&summary, "each_cafe");
    assert_eq!(each.title, "For each cafe");
    assert_eq!(each.detail, "over find_cafes.json.results");
    let draft = find_step(&summary, "draft_message");
    assert_eq!(draft.title, "Ask a model");
    assert_eq!(draft.detail, "claude-haiku-4-5");
    let approve = find_step(&summary, "approve_message");
    assert_eq!(approve.title, "Ask me before continuing");
    assert!(approve.needs_approval);
    assert!(approve.detail.starts_with("Send this message to"), "{}", approve.detail);
    assert!(approve.detail.chars().count() <= 80);
    let send = find_step(&summary, "send_message");
    assert_eq!(send.detail, "POST graph.facebook.com");
    assert!(!send.needs_approval);
    let confirm = find_step(&summary, "confirm_search");
    assert_eq!(confirm.title, "Ask before searching");
    assert!(confirm.needs_approval);
    let approvals = summary.steps.iter().filter(|step| step.needs_approval).count();
    assert_eq!(approvals, 2);
}

#[test]
fn approval_loop_inputs_and_providers() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    assert_eq!(
        summary.inputs,
        [
            FlowInput::text("area", "Area to search", true),
            FlowInput { input_type: "paragraph".into(), ..FlowInput::text("offer", "Offer to send", true) },
            FlowInput {
                input_type: "number".into(),
                default_value: Some(serde_json::json!(10)),
                ..FlowInput::text("max_cafes", "Max cafes", false)
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
    // Feature-specific rules live in `agent_builder/guides/`; this cheat-sheet only
    // lists node types. The cap keeps the builder's system prompt small.
    assert!(guide.lines().count() <= 175, "{} lines", guide.lines().count());
    for needle in ["human-input", "http-request", "iteration-start", "{{#", "handle", "llm"] {
        assert!(guide.contains(needle), "missing {needle}");
    }
}

/// A small flow that posts straight after the start node.
const DIRECT_POST: &str = r#"
version: "1"
name: direct-post
graph:
  nodes:
    - { id: start, type: start, variables: [] }
    - id: notify
      type: http-request
      title: Notify the team
      method: post
      url: "https://example.com/hooks/notify"
    - { id: end, type: end, outputs: [] }
  edges:
    - { source: start, target: notify }
    - { source: notify, target: end }
"#;

#[test]
fn approval_loop_sends_only_after_approval() {
    assert_eq!(
        find_unapproved_sending_steps(APPROVAL_LOOP, &crate::flow::TrustedHosts::none()).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn reading_steps_need_no_approval() {
    assert_eq!(
        find_unapproved_sending_steps(SIMPLE_ANSWER, &crate::flow::TrustedHosts::none()).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn post_without_approval_is_reported() {
    assert_eq!(
        find_unapproved_sending_steps(DIRECT_POST, &crate::flow::TrustedHosts::none()).unwrap(),
        vec!["Notify the team".to_owned()]
    );
}

#[test]
fn a_bypass_around_the_approval_is_reported() {
    let bypassed = test_fixtures::without_search_confirmation(APPROVAL_LOOP).replace(
        "    - { source: draft_message, target: approve_message }",
        "    - { source: draft_message, target: approve_message }\n    - { source: draft_message, target: send_message }",
    );
    assert_ne!(bypassed, APPROVAL_LOOP, "fixture edge text changed; update this test");
    // Without "Ask before searching" the search (it carries the area and the Maps key) is unapproved too.
    assert_eq!(
        find_unapproved_sending_steps(&bypassed, &crate::flow::TrustedHosts::none()).unwrap(),
        vec!["Find cafes on Google Maps".to_owned(), "Send the WhatsApp message".to_owned()]
    );
}

#[test]
fn approval_before_a_loop_covers_sending_steps_inside_it() {
    let approval_moved = test_fixtures::without_search_confirmation(APPROVAL_LOOP)
        .replace("      type: human-input\n      parent: each_cafe\n", "      type: human-input\n")
        .replace(
            "    - { source: find_cafes, target: each_cafe }",
            "    - { source: find_cafes, target: approve_message }\n    - { source: approve_message, target: each_cafe, handle: send }",
        )
        .replace("    - { source: draft_message, target: approve_message }\n", "    - { source: draft_message, target: send_message }\n")
        .replace("    - { source: approve_message, target: send_message, handle: send }\n", "")
        .replace("{{#each_cafe.item.name#}}?\\n\\n{{#draft_message.text#}}", "all cafes?");
    // The send inside the loop is covered; only the search before the approval is not.
    assert_eq!(
        find_unapproved_sending_steps(&approval_moved, &crate::flow::TrustedHosts::none()).unwrap(),
        vec!["Find cafes on Google Maps".to_owned()]
    );
}

#[test]
fn approval_loop_declares_its_secrets() {
    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    let names: Vec<&str> = summary.env.iter().map(|variable| variable.name.as_str()).collect();
    assert_eq!(names, ["MAPS_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    let secret_flags: Vec<bool> = summary.env.iter().map(|variable| variable.is_secret).collect();
    assert_eq!(secret_flags, [true, true, false]);
    assert!(summary.env.iter().all(|variable| !variable.has_default));
}

#[test]
fn flows_without_env_have_none() {
    assert!(summarize_flow(SIMPLE_ANSWER).unwrap().env.is_empty());
}

#[test]
fn references_read_as_plain_words_in_step_details() {
    use super::summary::readable_references;
    assert_eq!(
        readable_references("Send this promotion to {{#each_business.item.name#}}? {{#draft_message.text#}}"),
        "Send this promotion to ‹name›? ‹draft message›"
    );
    assert_eq!(
        readable_references("Cafes in {{#start.area#}} with {{#env.MAPS_API_KEY#}}"),
        "Cafes in ‹area› with ‹MAPS_API_KEY›"
    );
    assert_eq!(readable_references("No references"), "No references");
    assert_eq!(readable_references("Broken {{#start.area"), "Broken {{#start.area");

    let summary = summarize_flow(APPROVAL_LOOP).unwrap();
    let approval = find_step(&summary, "approve_message");
    assert!(!approval.detail.contains("{{#"), "{}", approval.detail);
}

#[test]
fn http_steps_calling_placeholder_addresses_are_found() {
    assert!(find_placeholder_http_steps(APPROVAL_LOOP).unwrap().is_empty());
    let with_placeholder = APPROVAL_LOOP.replace(
        "https://graph.facebook.com/v21.0/{{#env.WHATSAPP_PHONE_NUMBER_ID#}}/messages",
        "https://api.example.com/send-promotion",
    );
    assert_eq!(
        find_placeholder_http_steps(&with_placeholder).unwrap(),
        vec!["Send the WhatsApp message (api.example.com)".to_owned()]
    );
}

#[test]
fn every_approval_bypass_trick_is_caught() {
    for (trick, draft, flagged_step) in test_fixtures::approval_bypass_drafts() {
        let graph = compile_draft(&draft).unwrap_or_else(|error| panic!("{trick}: {error}"));
        let unapproved = approval::unapproved_sending_node_ids(&graph, &TrustedHosts::none());
        let timeouts: Vec<String> = approval::timeouts_that_send(&graph, &TrustedHosts::none())
            .into_iter()
            .map(|timeout| timeout.approval_node_id)
            .collect();
        assert!(
            unapproved.iter().chain(&timeouts).any(|node_id| node_id == flagged_step),
            "{trick}: unapproved {unapproved:?}, timeouts {timeouts:?}"
        );
    }
}

#[test]
fn codex_output_reaching_a_reading_step_needs_an_approval() {
    let direct = test_fixtures::model_output_into_a_search("codex-cli", false, false);
    assert_eq!(
        find_unapproved_sending_steps(&direct, &crate::flow::TrustedHosts::none()).unwrap(),
        vec!["Search places".to_owned()]
    );
    let through_another_model = test_fixtures::model_output_into_a_search("codex-cli", true, false);
    assert_eq!(
        find_unapproved_sending_steps(&through_another_model, &crate::flow::TrustedHosts::none()).unwrap(),
        vec!["Search places".to_owned()]
    );
    let approved = test_fixtures::model_output_into_a_search("codex-cli", true, true);
    assert_eq!(
        find_unapproved_sending_steps(&approved, &crate::flow::TrustedHosts::none()).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn other_providers_output_may_reach_a_reading_step_without_approval() {
    for provider in ["openai", "claude-cli"] {
        let flow_yaml = test_fixtures::model_output_into_a_search(provider, true, false);
        assert_eq!(
            find_unapproved_sending_steps(&flow_yaml, &crate::flow::TrustedHosts::none()).unwrap(),
            Vec::<String>::new(),
            "{provider}"
        );
    }
}

#[test]
fn an_approval_that_stops_or_skips_on_timeout_is_allowed() {
    let stops = test_fixtures::timeout_draft_repaired();
    assert_eq!(find_timeouts_that_send(&stops, &crate::flow::TrustedHosts::none()).unwrap(), Vec::<String>::new());
    assert_eq!(
        find_unapproved_sending_steps(&stops, &crate::flow::TrustedHosts::none()).unwrap(),
        Vec::<String>::new()
    );
    let skips = stops.replace("on_expire: stop", "on_expire: { action: skip }");
    assert_eq!(find_timeouts_that_send(&skips, &crate::flow::TrustedHosts::none()).unwrap(), Vec::<String>::new());
    // graphrt refuses a button the step does not have, and a bare id instead of `{ action: <id> }`.
    for refused in ["on_expire: { action: publish }", "on_expire: skip"] {
        let document = stops.replace("on_expire: stop", refused);
        let error = find_timeouts_that_send(&document, &crate::flow::TrustedHosts::none()).unwrap_err();
        assert!(error.to_string().contains("on_expire"), "{refused}: {error}");
    }
}

#[test]
fn a_timeout_answer_that_leads_to_a_send_names_both_steps() {
    let (_, draft, _) = test_fixtures::approval_bypass_drafts().pop().unwrap();
    let messages = find_timeouts_that_send(&draft, &crate::flow::TrustedHosts::none()).unwrap();
    assert_eq!(messages.len(), 1);
    assert!(messages[0].contains("Ask before posting") && messages[0].contains("Post the note"), "{}", messages[0]);
    assert!(messages[0].contains("`stop`"), "{}", messages[0]);
    // The bare id older documents used is upgraded to `{ action: send }`, and caught the same way.
    let as_plain_answer = draft.replace("on_expire: { action: send }", "on_timeout: send");
    let upgraded = crate::flow::migration::upgraded_flow_yaml(&as_plain_answer).unwrap();
    assert_eq!(find_timeouts_that_send(&upgraded, &crate::flow::TrustedHosts::none()).unwrap().len(), 1);
}

#[test]
fn a_timeout_answer_into_a_loop_with_a_send_inside_is_caught() {
    // The per-message approval moved in front of the loop, answering `send` on timeout.
    let answers_into_the_loop = test_fixtures::without_search_confirmation(APPROVAL_LOOP)
        .replace("      type: human-input\n      parent: each_cafe\n", "      type: human-input\n      on_expire: { action: send }\n")
        .replace(
            "    - { source: find_cafes, target: each_cafe }",
            "    - { source: find_cafes, target: approve_message }\n    - { source: approve_message, target: each_cafe, handle: send }",
        )
        .replace("    - { source: draft_message, target: approve_message }\n", "    - { source: draft_message, target: send_message }\n")
        .replace("    - { source: approve_message, target: send_message, handle: send }\n", "")
        .replace("{{#each_cafe.item.name#}}?\\n\\n{{#draft_message.text#}}", "all cafes?");
    let messages = find_timeouts_that_send(&answers_into_the_loop, &crate::flow::TrustedHosts::none()).unwrap();
    assert_eq!(messages.len(), 1, "{messages:?}");
    assert!(messages[0].contains("Send the WhatsApp message"), "{}", messages[0]);
}

fn weather_trusted() -> TrustedHosts {
    TrustedHosts::from_entries([test_fixtures::WEATHER_HOST])
}

#[test]
fn a_lookup_on_a_trusted_host_needs_no_approval() {
    let lookup = test_fixtures::trusted_weather_lookup();
    assert_eq!(find_unapproved_sending_steps(&lookup, &weather_trusted()).unwrap(), Vec::<String>::new());
    let untrusted = find_unapproved_steps(&lookup, &TrustedHosts::none()).unwrap();
    assert_eq!(untrusted.len(), 1);
    assert_eq!(untrusted[0].label, "Look up the weather");
    assert_eq!(untrusted[0].trustable_host.as_deref(), Some(test_fixtures::WEATHER_HOST));
    let wildcard = TrustedHosts::from_entries(["*.open-meteo.com"]);
    assert!(find_unapproved_steps(&lookup, &wildcard).unwrap().is_empty());
}

#[test]
fn trusting_a_host_never_covers_a_write_to_it() {
    let url = format!("https://{}/v1/forecast?q={{{{#start.note#}}}}", test_fixtures::WEATHER_HOST);
    let write = test_fixtures::weather_lookup("post", &url);
    let unapproved = find_unapproved_steps(&write, &weather_trusted()).unwrap();
    assert_eq!(unapproved.len(), 1);
    assert_eq!(unapproved[0].trustable_host, None, "trusting cannot fix a write");
}

#[test]
fn codex_output_reaching_a_trusted_lookup_still_needs_an_approval() {
    let flow_yaml = test_fixtures::codex_output_into_a_lookup();
    let unapproved = find_unapproved_steps(&flow_yaml, &weather_trusted()).unwrap();
    assert_eq!(unapproved.len(), 1);
    assert_eq!(unapproved[0].trustable_host, None, "trusting the host would not help");
}

#[test]
fn a_chatbot_can_look_up_on_a_trusted_host() {
    let chatbot = test_fixtures::chatbot_weather_lookup();
    assert!(find_unapproved_sending_steps(&chatbot, &weather_trusted()).unwrap().is_empty());
    assert_eq!(find_unapproved_sending_steps(&chatbot, &TrustedHosts::none()).unwrap(), ["Look up the weather"]);
}

#[test]
fn runs_with_trusted_lookups_are_recognized() {
    let graph = compile_draft(&test_fixtures::trusted_weather_lookup()).unwrap();
    assert!(has_trusted_lookups(&graph, &weather_trusted()));
    assert!(!has_trusted_lookups(&graph, &TrustedHosts::none()));
    let plain_read = compile_draft(&test_fixtures::weather_lookup("get", "https://api.open-meteo.com/v1")).unwrap();
    assert!(!has_trusted_lookups(&plain_read, &weather_trusted()), "a plain read needs no trust");
}

#[test]
fn a_timeout_answer_into_a_trusted_lookup_does_not_send() {
    let ask = "    - { id: ask, type: human-input, prompt: \"Look it up?\", expire_after_ms: 1000, \
               on_expire: { action: submit } }\n    - id: lookup\n";
    let with_approval = test_fixtures::trusted_weather_lookup().replace("    - id: lookup\n", ask).replace(
        "{ source: start, target: lookup }",
        "{ source: start, target: ask }\n    - { source: ask, target: lookup, handle: submit }",
    );
    assert!(find_timeouts_that_send(&with_approval, &weather_trusted()).unwrap().is_empty());
    assert_eq!(find_timeouts_that_send(&with_approval, &TrustedHosts::none()).unwrap().len(), 1);
}

/// A list input may describe its rows with `json_schema`; the form builds its columns from
/// it. The document still compiles: the runtime does not read the field.
#[test]
fn a_list_inputs_schema_reaches_the_form_and_the_flow_still_compiles() {
    let yaml = r#"
version: "1"
graph:
  nodes:
    - id: start
      type: start
      variables:
        - variable: items
          label: Items
          type: json
          required: true
          json_schema:
            type: array
            items:
              type: object
              properties:
                description: { type: string, title: Description }
                quantity: { type: number }
        - { variable: note, type: json, schema: "not a schema" }
    - { id: end, type: end, outputs: [{ variable: items, value_selector: [start, items] }] }
  edges:
    - { source: start, target: end }
"#;
    compile_flow(yaml).unwrap();
    let inputs = summarize_flow(yaml).unwrap().inputs;
    let schema = inputs[0].schema.as_ref().unwrap();
    assert_eq!(schema["items"]["properties"]["quantity"]["type"], "number");
    assert_eq!(inputs[1].schema, None, "anything that is not an object is not a schema");
}

/// The classifier goes straight to the reply, which reads a model step that never runs.
const SKIPPED_MODEL_STEP: &str = r#"
version: "1"
name: bakery
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: classify
      type: question-classifier
      query_variable_selector: [start, message]
      model: { provider: openai, name: gpt-4o-mini }
      classes:
        - { id: hours, name: Opening hours }
        - { id: other, name: Anything else }
    - id: answer_hours
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "{{#start.message#}}" }
    - id: reply_hours
      type: answer
      answer: "{{#answer_hours.text#}}"
    - id: reply_other
      type: answer
      answer: "Please ask the owner"
    - id: end
      type: end
      outputs:
        - { variable: kind, value_selector: [classify, class_name] }
  edges:
    - { source: start, target: classify }
    - { source: classify, target: reply_hours, handle: hours }
    - { source: classify, target: reply_other, handle: other }
    - { source: reply_hours, target: end }
    - { source: reply_other, target: end }
"#;

#[test]
fn finds_a_step_that_reads_a_step_which_never_runs_before_it() {
    let unrun = find_unrun_references(SKIPPED_MODEL_STEP).unwrap();
    assert_eq!(unrun, vec![UnrunReference { reader_id: "reply_hours".into(), read_id: "answer_hours".into() }]);
    assert!(unrun[0].message().contains("`answer_hours` never runs before `reply_hours`"), "{}", unrun[0].message());

    let fixed = SKIPPED_MODEL_STEP
        .replace("- { source: classify, target: reply_hours, handle: hours }", "- { source: classify, target: answer_hours, handle: hours }\n    - { source: answer_hours, target: reply_hours }")
        ;
    assert_eq!(find_unrun_references(&fixed).unwrap(), vec![]);
}

#[test]
fn working_flows_read_only_steps_that_ran_before() {
    let fixtures = [SIMPLE_ANSWER, APPROVAL_LOOP];
    for fixture in fixtures {
        assert_eq!(find_unrun_references(fixture).unwrap(), vec![], "{fixture}");
    }
}
