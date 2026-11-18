//! Compares two flow summaries to describe a revision in plain words.
//!
//! Steps are matched by id; a step counts as changed when its type, title or
//! detail differ. Changes the summary does not show (e.g. the full text of a
//! prompt past its excerpt) are reported as "Changed step settings".

use crate::flow::{FlowStep, FlowSummary};

/// Titles listed in a summary sentence before "and N more".
const MAX_LISTED_TITLES: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FlowChanges {
    /// Added or changed step ids, in the new flow's order.
    pub changed_step_ids: Vec<String>,
    /// e.g. "Changed 2 steps: Write a short message, Send WhatsApp".
    pub summary: String,
}

pub(super) fn compare_flows(before: &FlowSummary, after: &FlowSummary) -> FlowChanges {
    let changed_steps: Vec<&FlowStep> = after
        .steps
        .iter()
        .filter(|step| before.steps.iter().find(|old| old.id == step.id).is_none_or(|old| step_differs(old, step)))
        .collect();
    let removed_steps: Vec<&FlowStep> =
        before.steps.iter().filter(|old| !after.steps.iter().any(|step| step.id == old.id)).collect();

    let mut sentences = Vec::new();
    if !changed_steps.is_empty() {
        sentences.push(steps_sentence("Changed", &changed_steps));
    }
    if !removed_steps.is_empty() {
        sentences.push(steps_sentence("Removed", &removed_steps));
    }
    if before.inputs != after.inputs {
        sentences.push("Updated the inputs".to_owned());
    }
    let summary = if sentences.is_empty() { "Changed step settings".to_owned() } else { sentences.join(". ") };
    FlowChanges { changed_step_ids: changed_steps.iter().map(|step| step.id.clone()).collect(), summary }
}

fn step_differs(old: &FlowStep, new: &FlowStep) -> bool {
    old.node_type != new.node_type || old.title != new.title || old.detail != new.detail
}

/// "Changed 2 steps: A, B" / "Removed 1 step: C" / "... and 3 more".
fn steps_sentence(verb: &str, steps: &[&FlowStep]) -> String {
    let noun = if steps.len() == 1 { "step" } else { "steps" };
    let mut titles: Vec<&str> = steps.iter().take(MAX_LISTED_TITLES).map(|step| step.title.as_str()).collect();
    let hidden = steps.len().saturating_sub(MAX_LISTED_TITLES);
    let more = format!("and {hidden} more");
    if hidden > 0 {
        titles.push(&more);
    }
    format!("{verb} {} {noun}: {}", steps.len(), titles.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::FlowInput;

    fn step(id: &str, title: &str, detail: &str) -> FlowStep {
        FlowStep {
            id: id.into(),
            node_type: "llm".into(),
            title: title.into(),
            detail: detail.into(),
            needs_approval: false,
            depth: 0,
        }
    }

    fn summary(steps: Vec<FlowStep>) -> FlowSummary {
        FlowSummary { steps, inputs: Vec::new(), model_providers: Vec::new(), env: Vec::new() }
    }

    #[test]
    fn changed_and_added_steps_are_listed_in_new_order() {
        let before = summary(vec![step("a", "Find cafes", "x"), step("b", "Write", "y"), step("c", "Send", "z")]);
        let after = summary(vec![
            step("a", "Find cafes", "x"),
            step("b", "Write a short message", "y"),
            step("new", "Ask me first", ""),
            step("c", "Send", "z"),
        ]);
        let changes = compare_flows(&before, &after);
        assert_eq!(changes.changed_step_ids, vec!["b", "new"]);
        assert_eq!(changes.summary, "Changed 2 steps: Write a short message, Ask me first");
    }

    #[test]
    fn type_or_detail_change_counts() {
        let before = summary(vec![step("a", "Find", "gpt-4o-mini")]);
        let mut retyped = step("a", "Find", "gpt-4o-mini");
        retyped.node_type = "agent".into();
        assert_eq!(compare_flows(&before, &summary(vec![retyped])).changed_step_ids, vec!["a"]);
        let redetailed = summary(vec![step("a", "Find", "gpt-4o")]);
        assert_eq!(compare_flows(&before, &redetailed).summary, "Changed 1 step: Find");
    }

    #[test]
    fn removed_steps_and_inputs_are_mentioned() {
        let before = summary(vec![step("a", "Find", ""), step("b", "Approve", "")]);
        let mut after = summary(vec![step("a", "Find", "")]);
        after.inputs.push(FlowInput { name: "city".into(), label: "City".into(), required: true });
        let changes = compare_flows(&before, &after);
        assert!(changes.changed_step_ids.is_empty());
        assert_eq!(changes.summary, "Removed 1 step: Approve. Updated the inputs");
    }

    #[test]
    fn invisible_change_has_generic_summary() {
        let flow = summary(vec![step("a", "Find", "")]);
        let changes = compare_flows(&flow, &flow.clone());
        assert!(changes.changed_step_ids.is_empty());
        assert_eq!(changes.summary, "Changed step settings");
    }

    #[test]
    fn long_lists_are_shortened() {
        let after = summary((0..7).map(|index| step(&format!("s{index}"), &format!("Step {index}"), "")).collect());
        let changes = compare_flows(&summary(Vec::new()), &after);
        assert_eq!(changes.changed_step_ids.len(), 7);
        assert_eq!(changes.summary, "Changed 7 steps: Step 0, Step 1, Step 2, Step 3, Step 4, and 2 more");
    }
}
