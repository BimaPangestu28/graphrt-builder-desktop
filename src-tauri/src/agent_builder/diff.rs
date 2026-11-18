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

/// True when a step's type, title or detail differ between two versions.
pub(crate) fn step_differs(old: &FlowStep, new: &FlowStep) -> bool {
    old.node_type != new.node_type || old.title != new.title || old.detail != new.detail
}

/// How one step id fares between two step lists (see [`match_steps`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum StepMatch<'a> {
    /// Only in `after`.
    Added(&'a FlowStep),
    /// Only in `before`.
    Removed(&'a FlowStep),
    /// In both, and [`step_differs`].
    Changed { before: &'a FlowStep, after: &'a FlowStep },
    /// In both, with the same type, title and detail.
    Unchanged { before: &'a FlowStep, after: &'a FlowStep },
}

/// Matches steps by id. Rows follow `before`'s order; steps only in `after` are
/// inserted right after the step that precedes them in `after` (or first).
pub(crate) fn match_steps<'a>(before: &'a [FlowStep], after: &'a [FlowStep]) -> Vec<StepMatch<'a>> {
    let mut matches = Vec::with_capacity(before.len().max(after.len()));
    append_added_after(before, after, None, &mut matches);
    for old in before {
        let Some(after_index) = after.iter().position(|step| step.id == old.id) else {
            matches.push(StepMatch::Removed(old));
            continue;
        };
        let new = &after[after_index];
        matches.push(if step_differs(old, new) {
            StepMatch::Changed { before: old, after: new }
        } else {
            StepMatch::Unchanged { before: old, after: new }
        });
        append_added_after(before, after, Some(after_index), &mut matches);
    }
    matches
}

/// Pushes the run of `after`-only steps that follows `after_index` (or starts the list).
fn append_added_after<'a>(
    before: &[FlowStep],
    after: &'a [FlowStep],
    after_index: Option<usize>,
    matches: &mut Vec<StepMatch<'a>>,
) {
    let start = after_index.map_or(0, |index| index + 1);
    for step in after.iter().skip(start) {
        if before.iter().any(|old| old.id == step.id) {
            return;
        }
        matches.push(StepMatch::Added(step));
    }
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
    fn match_steps_keeps_before_order_and_inserts_added_steps() {
        let before = vec![step("a", "Find", ""), step("b", "Write", "x"), step("c", "Send", "")];
        let after = vec![
            step("new_first", "Ask", ""),
            step("a", "Find", ""),
            step("b", "Write", "y"),
            step("d", "Approve", ""),
        ];
        let kinds: Vec<(&str, &str)> = match_steps(&before, &after)
            .into_iter()
            .map(|matched| match matched {
                StepMatch::Added(step) => ("added", step.id.as_str()),
                StepMatch::Removed(step) => ("removed", step.id.as_str()),
                StepMatch::Changed { after, .. } => ("changed", after.id.as_str()),
                StepMatch::Unchanged { after, .. } => ("unchanged", after.id.as_str()),
            })
            .collect();
        assert_eq!(
            kinds,
            [("added", "new_first"), ("unchanged", "a"), ("changed", "b"), ("added", "d"), ("removed", "c")]
        );
    }

    #[test]
    fn long_lists_are_shortened() {
        let after = summary((0..7).map(|index| step(&format!("s{index}"), &format!("Step {index}"), "")).collect());
        let changes = compare_flows(&summary(Vec::new()), &after);
        assert_eq!(changes.changed_step_ids.len(), 7);
        assert_eq!(changes.summary, "Changed 7 steps: Step 0, Step 1, Step 2, Step 3, Step 4, and 2 more");
    }
}
