//! What a change in the builder chat did to a plan, in plain words.
//!
//! A small model asked for two things in one change ("write the note in Indonesian and add
//! the subject Terima kasih") sometimes does one. The person reads, step by step, what each
//! changed step now does, and any text the change quoted that the agent does not hold.

use super::plan::{Plan, PlanStep};

/// Sentences for the person: each added, removed or changed step with what it now does, a
/// changed schedule, and a quoted phrase of `request` that the new plan does not contain.
pub(super) fn describe_changes(before: &Plan, after: &Plan, request: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    for (index, step) in after.steps.iter().enumerate() {
        let number = index + 1;
        match before.steps.get(index) {
            Some(old) if old == step => {}
            Some(old) if std::mem::discriminant(old) == std::mem::discriminant(step) => {
                sentences.push(format!("Step {number} ({}) now: {}", step.title(), what_it_does(step)));
            }
            _ => sentences.push(format!("Step {number} is new ({}): {}", step.title(), what_it_does(step))),
        }
    }
    for old in before.steps.iter().skip(after.steps.len()) {
        sentences.push(format!("Removed: {}", old.title()));
    }
    for input in after.inputs.iter().filter(|input| !before.inputs.iter().any(|old| old.name == input.name)) {
        sentences.push(format!("New input: {}", input.label));
    }
    if before.schedule != after.schedule {
        sentences.push(match after.schedule {
            Some(schedule) => format!("Runs by itself {}", schedule.in_words()),
            None => "No longer runs by itself".to_owned(),
        });
    }
    let plan_text = serde_json::to_string(after).unwrap_or_default().to_lowercase();
    for phrase in quoted_phrases(request) {
        if !plan_text.contains(&phrase.to_lowercase()) {
            sentences.push(format!(
                "Not changed yet: \"{phrase}\" is not in the agent. Ask again, or edit the step yourself."
            ));
        }
    }
    sentences
}

/// What a step does, as the plan says it.
fn what_it_does(step: &PlanStep) -> String {
    match step {
        PlanStep::Write { instruction, .. } => instruction.clone(),
        PlanStep::Lookup { url, .. } => format!("reads {}", url.as_written()),
        PlanStep::Approve { question, .. } => format!("asks \"{question}\""),
        PlanStep::Use { instruction, operation, fields, .. } => {
            let fixed: Vec<String> = fields
                .iter()
                .filter_map(|(name, value)| {
                    value.as_str().filter(|text| !text.contains('{')).map(|text| format!("{name}: {text}"))
                })
                .collect();
            if fixed.is_empty() {
                format!("{instruction} ({operation})")
            } else {
                format!("{instruction} ({operation}; {})", fixed.join(", "))
            }
        }
    }
}

/// Text in double quotes in `request` ("…" or “…”, more than one character). Single quotes
/// are left out: they are apostrophes as often ("don't", "customer's").
fn quoted_phrases(request: &str) -> Vec<String> {
    let mut phrases = Vec::new();
    for (open, close) in [('"', '"'), ('“', '”')] {
        let mut rest = request;
        while let Some(start) = rest.find(open) {
            let after_open = &rest[start + open.len_utf8()..];
            let Some(end) = after_open.find(close) else { break };
            let phrase = after_open[..end].trim();
            if phrase.chars().count() > 1 && !phrases.iter().any(|known: &String| known == phrase) {
                phrases.push(phrase.to_owned());
            }
            rest = &after_open[end + close.len_utf8()..];
        }
    }
    phrases
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::agent_builder::guided::plan::PlanInput;

    fn plan(steps: Vec<PlanStep>) -> Plan {
        Plan {
            summary: String::new(),
            name: String::new(),
            inputs: vec![PlanInput {
                name: "address".into(),
                label: "Email".into(),
                long_text: false,
                value: String::new(),
            }],
            steps,
            schedule: None,
            job_words: Default::default(),
        }
    }

    fn write(instruction: &str) -> PlanStep {
        PlanStep::Write { title: "Write the note".into(), instruction: instruction.into() }
    }

    fn send(subject: &str) -> PlanStep {
        let fields = BTreeMap::from([
            ("subject".to_owned(), serde_json::json!(subject)),
            ("to".to_owned(), serde_json::json!("{address}")),
        ]);
        PlanStep::Use {
            title: "Send email".into(),
            instruction: "Send the note".into(),
            operation: "email.send_email".into(),
            fields,
        }
    }

    #[test]
    fn every_changed_step_says_what_it_does_now() {
        let before = plan(vec![write("Write a short thank-you note."), send("Thank you")]);
        let after = plan(vec![write("Write a short thank-you note in Indonesian."), send("Terima kasih")]);

        let sentences =
            describe_changes(&before, &after, "Write it in Indonesian and use the subject \"Terima kasih\"");

        assert_eq!(
            sentences,
            [
                "Step 1 (Write the note) now: Write a short thank-you note in Indonesian.",
                "Step 2 (Send email) now: Send the note (email.send_email; subject: Terima kasih)",
            ]
        );
    }

    #[test]
    fn a_quoted_phrase_the_agent_does_not_hold_is_named() {
        let before = plan(vec![write("Write a short thank-you note.")]);
        let after = plan(vec![write("Write a short thank-you note in Indonesian.")]);

        let sentences = describe_changes(
            &before,
            &after,
            "Use Indonesian and sign it “Tim Dapur Rina”, don't add a customer's name",
        );

        assert_eq!(sentences.len(), 2, "{sentences:?}");
        assert!(sentences[1].starts_with("Not changed yet: \"Tim Dapur Rina\""), "{sentences:?}");
    }

    #[test]
    fn added_and_removed_steps_and_a_schedule_are_named() {
        let before = plan(vec![write("A"), send("S")]);
        let mut after = plan(vec![write("A")]);
        after.schedule = Some(super::super::plan::Schedule::daily());
        let sentences = describe_changes(&before, &after, "stop sending, run every morning");
        assert_eq!(sentences, ["Removed: Send email", "Runs by itself every day at 08:00"]);
    }
}
