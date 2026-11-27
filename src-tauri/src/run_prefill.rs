//! What the test form (screen 06) is prefilled with: the inputs of the agent's latest run,
//! minus the inputs whose default changed since.
//!
//! The form keeps the last run's values so a second test needs no retyping. But when the
//! agent was changed after that run ("make the invoice for Acme in USD"), the builder
//! rewrites the defaults of the inputs it touched, and the old values would silently bring
//! the previous job back. So an input whose default differs between the version the last
//! run used and the current one is left out: the form then shows the new default.

use serde_json::Value as Json;

use crate::error::AppResult;
use crate::flow::{self, FlowInput};
use crate::storage::Database;

/// Inputs of the agent's latest run to prefill the next one with; `None` when it never ran.
///
/// # Errors
/// `NotFound` when the agent does not exist; `Database` when storage fails.
pub fn last_run_inputs_for_form(db: &Database, agent_id: &str) -> AppResult<Option<Json>> {
    let Some((run_version, inputs)) = db.get_last_run_inputs_with_version(agent_id)? else { return Ok(None) };
    let agent = db.get_agent(agent_id)?;
    if run_version == agent.current_version {
        return Ok(Some(inputs));
    }
    // A version that is gone or unreadable cannot be compared: keep the last values.
    let earlier_inputs = db
        .get_agent_version(agent_id, run_version)
        .ok()
        .and_then(|version| flow::summarize_flow(&version.flow_yaml).ok())
        .map(|summary| summary.inputs);
    let current_inputs = flow::summarize_flow(&agent.flow_yaml).ok().map(|summary| summary.inputs);
    Ok(Some(match (earlier_inputs, current_inputs) {
        (Some(earlier), Some(current)) => without_changed_defaults(inputs, &earlier, &current),
        _ => inputs,
    }))
}

/// `last_inputs` without the inputs whose default is not what it was in `earlier`.
fn without_changed_defaults(mut last_inputs: Json, earlier: &[FlowInput], current: &[FlowInput]) -> Json {
    let Some(values) = last_inputs.as_object_mut() else { return last_inputs };
    for input in current {
        let earlier_default = earlier.iter().find(|known| known.name == input.name).map(|known| &known.default_value);
        // An input the earlier version did not have has nothing to carry over either.
        if earlier_default != Some(&input.default_value) {
            values.remove(&input.name);
        }
    }
    last_inputs
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, NewAgent, RunTrigger};
    use crate::storage::test_support::test_database;

    fn invoice_flow(client: &str, currency: &str) -> String {
        format!(
            r#"name: invoice
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: client, label: Client, type: text-input, required: true, default: "{client}" }}
        - {{ variable: currency, label: Currency, type: text-input, required: true, default: "{currency}" }}
        - {{ variable: notes, label: Notes, type: paragraph, required: false }}
    - id: end
      type: end
      outputs:
        - {{ variable: summary, value_selector: [start, client] }}
  edges:
    - {{ source: start, target: end }}
"#
        )
    }

    fn input(name: &str, default_value: Option<Json>) -> FlowInput {
        FlowInput { default_value, ..FlowInput::text(name, name, true) }
    }

    #[test]
    fn an_input_whose_default_changed_is_left_to_the_new_default() {
        let earlier = [
            input("client", Some(json!("PT Maju Bersama"))),
            input("currency", Some(json!("IDR"))),
            input("notes", None),
        ];
        let current = [
            input("client", Some(json!("Acme Trading Pte Ltd"))),
            input("currency", Some(json!("IDR"))),
            input("notes", None),
            input("due_date", None),
        ];
        let last = json!({ "client": "PT Maju Bersama", "currency": "IDR", "notes": "Thanks", "due_date": "stale" });
        let kept = without_changed_defaults(last, &earlier, &current);
        assert_eq!(kept, json!({ "currency": "IDR", "notes": "Thanks" }));
    }

    #[test]
    fn the_last_values_are_kept_until_the_agent_changes_a_default() {
        let db = test_database();
        let agent = db
            .create_agent(NewAgent {
                name: "Invoice".into(),
                kind: AgentKind::Task,
                description: "Make an invoice".into(),
                flow_yaml: invoice_flow("PT Maju Bersama", "IDR"),
            })
            .unwrap();
        assert_eq!(last_run_inputs_for_form(&db, &agent.id).unwrap(), None);

        let run = db.insert_run(&agent.id, agent.current_version, RunTrigger::Test).unwrap();
        let typed = json!({ "client": "PT Maju Bersama", "currency": "IDR", "notes": "Thanks" });
        db.save_run_inputs(&run.id, &typed).unwrap();
        assert_eq!(last_run_inputs_for_form(&db, &agent.id).unwrap(), Some(typed));

        // The builder chat changes the client and the currency; the notes input is untouched.
        db.update_agent_flow(&agent.id, &invoice_flow("Acme Trading Pte Ltd", "USD"), "Changed 2 inputs").unwrap();
        assert_eq!(last_run_inputs_for_form(&db, &agent.id).unwrap(), Some(json!({ "notes": "Thanks" })));
    }
}
