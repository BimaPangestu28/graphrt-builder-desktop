//! graphrt UI blocks (Adaptive Cards, charts, tables, KPI tiles, diagrams) found in runs, checked with
//! `graphrt_ui::validate` before the Run result screen or an approval card renders them.
//!
//! Which blocks a run shows: the blocks in the run's outputs (the `end` node, in output
//! order), because the workflow author chose them. A run whose outputs have none, or that has
//! not finished, shows the blocks its steps produced instead, in the order they finished (a
//! `ui-render` node, an agent's `ui` output). Equal blocks are shown once, at most
//! [`MAX_VISUALS`] in all. A block that fails validation is never sent to the screen: only
//! its kind and the reason, so a builder can fix the step.
//!
//! Blocks in chatbot replies are handled in `crate::conversations::visuals`.

use graphrt_core::value::Value;
use serde::Serialize;
use serde_json::Value as Json;

/// Most blocks one run shows.
pub const MAX_VISUALS: usize = 24;
/// Kind of the `human-input` node, whose outputs are the person's answers, not blocks to show.
const HUMAN_INPUT_NODE_KIND: &str = "human-input";

/// A validated block. Keep `src/api/runSummaryTypes.ts` (`RunVisual`) in sync.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunVisual {
    /// Stable within the run: `<source>-<index>`, for React keys.
    pub id: String,
    /// The step that produced it; `None` for the run's outputs.
    pub node_id: Option<String>,
    /// `adaptive_card`, `chart`, `table`, `stats` or `diagram`.
    pub kind: String,
    /// The block as validated (with `$ui` and `version`).
    pub block: Json,
}

/// A block that failed validation: shown as a short notice instead of the block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedVisual {
    pub node_id: Option<String>,
    /// The block's `$ui`, when it had a string one.
    pub kind: Option<String>,
    /// graphrt-ui's message, e.g. "at /series/0/values: has 5 values but `x.values` has 6...".
    pub reason: String,
}

/// What a run shows. Keep `src/api/runSummaryTypes.ts` in sync.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunVisuals {
    pub visuals: Vec<RunVisual>,
    pub rejected: Vec<RejectedVisual>,
}

impl RunVisuals {
    fn add(&mut self, block: &Json, node_id: Option<&str>, source: &str) {
        if self.visuals.len() >= MAX_VISUALS || self.visuals.iter().any(|visual| &visual.block == block) {
            return;
        }
        match graphrt_ui::validate(block) {
            Ok(valid) => self.visuals.push(RunVisual {
                id: format!("{source}-{}", self.visuals.len()),
                node_id: node_id.map(str::to_owned),
                kind: valid.kind().as_str().to_owned(),
                block: valid.into_json(),
            }),
            Err(error) => self.rejected.push(RejectedVisual {
                node_id: node_id.map(str::to_owned),
                kind: block.get(graphrt_ui::UI_KEY).and_then(Json::as_str).map(str::to_owned),
                reason: error.to_string(),
            }),
        }
    }
}

/// UI blocks in `value` (see `graphrt_core::ui::collect_ui_blocks`), as JSON.
fn blocks_in(value: &Json) -> Vec<Json> {
    graphrt_core::ui::collect_ui_blocks(&Value::from_json(value.clone())).iter().map(Value::to_json).collect()
}

/// The blocks a run shows (see the module docs).
///
/// @param events - The run's graphrt events as JSON, in order
/// @param outputs - The run's outputs, once it finished
pub fn collect_run_visuals(events: &[Json], outputs: Option<&Json>) -> RunVisuals {
    let mut visuals = RunVisuals::default();
    for block in outputs.map(blocks_in).unwrap_or_default() {
        visuals.add(&block, None, "output");
    }
    if !visuals.visuals.is_empty() || !visuals.rejected.is_empty() {
        return visuals;
    }
    let human_input_nodes: Vec<&str> = events
        .iter()
        .filter(|event| event.get("type").and_then(Json::as_str) == Some("node_started"))
        .filter(|event| event.get("kind").and_then(Json::as_str) == Some(HUMAN_INPUT_NODE_KIND))
        .filter_map(|event| event.get("node_id").and_then(Json::as_str))
        .collect();
    for event in events.iter().filter(|event| event.get("type").and_then(Json::as_str) == Some("node_succeeded")) {
        let node_id = event.get("node_id").and_then(Json::as_str);
        if node_id.is_some_and(|id| human_input_nodes.contains(&id)) {
            continue;
        }
        for block in event.get("outputs").map(blocks_in).unwrap_or_default() {
            visuals.add(&block, node_id, "step");
        }
    }
    visuals
}

/// The `card` of a `human-input` pause, when it is a valid block. An invalid one is dropped
/// (the plain form is shown instead) and its reason returned for the log.
pub fn read_pause_card(pause_data: &Json) -> (Option<Json>, Option<String>) {
    match pause_data.get("card") {
        None | Some(Json::Null) => (None, None),
        Some(card) => match graphrt_ui::validate(card) {
            Ok(valid) => (Some(valid.into_json()), None),
            Err(error) => (None, Some(error.to_string())),
        },
    }
}

/// Whether a card's `Action.OpenUrl` target may be opened in the browser: `https` with a
/// host, or `mailto`; no spaces or control characters (graphrt-ui's link rule).
pub fn is_openable_link(url: &str) -> bool {
    if url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("https://") {
        let host = rest.split(['/', '?', '#']).next().unwrap_or("");
        return !host.is_empty() && !host.contains('@');
    }
    lower.strip_prefix("mailto:").is_some_and(|address| !address.is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn chart(title: &str) -> Json {
        json!({"$ui": "chart", "version": 1, "type": "bar", "title": title,
               "x": {"values": ["Jan", "Feb"]}, "series": [{"name": "Sales", "values": [1, 2]}]})
    }

    fn started(node_id: &str, kind: &str) -> Json {
        json!({"type": "node_started", "frame": "", "node_id": node_id, "exec_id": node_id, "kind": kind})
    }

    fn succeeded(node_id: &str, outputs: Json) -> Json {
        json!({"type": "node_succeeded", "frame": "", "node_id": node_id, "exec_id": node_id, "outputs": outputs})
    }

    #[test]
    fn run_outputs_win_over_step_outputs() {
        let events = vec![succeeded("chart", json!({"data": chart("step")}))];
        let outputs = json!({"summary": "done", "sales": chart("output"), "kpis": {"$ui": "stats", "version": 1, "items": [{"label": "A", "value": 1}]}});
        let visuals = collect_run_visuals(&events, Some(&outputs));
        let kinds: Vec<&str> = visuals.visuals.iter().map(|v| v.kind.as_str()).collect();
        assert_eq!(kinds, ["chart", "stats"]);
        assert_eq!(visuals.visuals[0].block["title"], "output");
        assert_eq!(visuals.visuals[0].node_id, None);
        assert_eq!(visuals.visuals[1].id, "output-1");
    }

    #[test]
    fn without_output_blocks_steps_are_shown_once_in_order_without_answers() {
        let events = vec![
            started("ask", "human-input"),
            succeeded("ask", json!({"action": "approve", "card": chart("answer")})),
            succeeded("first", json!({"data": chart("a")})),
            succeeded("agent", json!({"text": "hi", "ui": [chart("b"), chart("a")]})),
        ];
        let visuals = collect_run_visuals(&events, Some(&json!({"summary": "no blocks"})));
        let titles: Vec<&Json> = visuals.visuals.iter().map(|v| &v.block["title"]).collect();
        assert_eq!(titles, [&json!("a"), &json!("b")]);
        assert_eq!(visuals.visuals[1].node_id.as_deref(), Some("agent"));
        assert!(collect_run_visuals(&events[..1], None).visuals.is_empty());
    }

    #[test]
    fn invalid_blocks_are_reported_not_shown() {
        let bad = json!({"$ui": "chart", "version": 1, "type": "bar", "x": {"values": ["a"]}, "series": [{"name": "s", "values": [1, 2]}]});
        let events = vec![succeeded("chart", json!({"data": bad}))];
        let visuals = collect_run_visuals(&events, None);
        assert!(visuals.visuals.is_empty());
        assert_eq!(visuals.rejected.len(), 1);
        assert_eq!(visuals.rejected[0].kind.as_deref(), Some("chart"));
        assert!(visuals.rejected[0].reason.contains("per category"), "{}", visuals.rejected[0].reason);
    }

    #[test]
    fn caps_the_number_of_blocks() {
        let blocks: Vec<Json> = (0..40).map(|i| chart(&format!("c{i}"))).collect();
        let visuals = collect_run_visuals(&[], Some(&json!({"many": blocks})));
        // graphrt-core collects at most 32 per value; the screen shows at most MAX_VISUALS.
        assert_eq!(visuals.visuals.len(), MAX_VISUALS);
    }

    #[test]
    fn pause_cards_are_validated() {
        let card = json!({"$ui": "adaptive_card", "version": 1,
                          "card": {"type": "AdaptiveCard", "version": "1.5", "body": [{"type": "TextBlock", "text": "Approve?"}]}});
        assert_eq!(read_pause_card(&json!({"card": card.clone()})), (Some(card), None));
        assert_eq!(read_pause_card(&json!({"prompt": "x"})), (None, None));
        let (none, reason) = read_pause_card(
            &json!({"card": {"$ui": "adaptive_card", "version": 1, "card": {"type": "AdaptiveCard", "version": "1.5", "body": [{"type": "Image", "url": "javascript:alert(1)"}]}}}),
        );
        assert_eq!(none, None);
        assert!(reason.is_some_and(|r| r.contains("images must be")));
    }

    #[test]
    fn only_https_and_mailto_links_open() {
        assert!(is_openable_link("https://shop.example.com/orders/1042"));
        assert!(is_openable_link("mailto:sales@example.com"));
        assert!(!is_openable_link("http://example.com"));
        assert!(!is_openable_link("https://"));
        assert!(!is_openable_link("https://user@evil.example"));
        assert!(!is_openable_link("file:///etc/passwd"));
        assert!(!is_openable_link("-a https://example.com"));
        assert!(!is_openable_link("https://example.com/a b"));
    }
}
