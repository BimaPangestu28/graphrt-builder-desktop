//! Reviewing a run that asks once per item (human-input inside an iteration)
//! with `run_review`, against real graphrt runs and mock models.

use super::*;
use crate::run_review::{get_run_review, latest_pending_review};

/// For each place: draft a message (mock model), then ask before "sending".
fn review_each_flow(is_parallel: bool) -> String {
    format!(
        r#"
version: "1"
name: review-each
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: places, type: json, required: true }}
    - id: each_place
      type: iteration
      title: For each place
      iterator_selector: [start, places]
      output_selector: [approve, action]
      is_parallel: {is_parallel}
      parallel_nums: 5
    - {{ id: each_start, type: iteration-start, parent: each_place }}
    - id: draft
      type: llm
      parent: each_place
      model: {{ provider: openai, name: gpt-4o-mini }}
      prompt_template:
        - {{ role: user, text: "Write to {{{{#each_place.item.name#}}}}" }}
    - id: approve
      type: human-input
      title: Ask me before sending
      parent: each_place
      prompt: "Send to {{{{#each_place.item.name#}}}}?"
      form:
        fields:
          - {{ name: message, label: Message, type: paragraph, required: true, default: "{{{{#draft.text#}}}}" }}
      actions:
        - {{ id: send, title: Send }}
        - {{ id: skip, title: Skip }}
    - id: end
      type: end
      outputs:
        - {{ variable: decisions, value_selector: [each_place, output] }}
  edges:
    - {{ source: start, target: each_place }}
    - {{ source: each_start, target: draft }}
    - {{ source: draft, target: approve }}
    - {{ source: each_place, target: end }}
"#
    )
}

fn places_input() -> serde_json::Value {
    json!({"places": [{"name": "[PLACE 1]"}, {"name": "[PLACE 2]"}]})
}

#[tokio::test]
async fn sequential_iteration_is_reviewed_one_item_at_a_time() {
    let harness = harness_with_answers(&["Hello one", "Hello two"]);
    let agent = create_agent(&harness.db, &review_each_flow(false));
    let run = harness.runs.start_run(&agent.id, RunTrigger::Schedule, places_input()).await.unwrap();
    assert_eq!(harness.db.get_run_inputs(&run.id).unwrap(), Some(places_input()));
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let review = get_run_review(&harness.db, &run.id).unwrap();
    assert_eq!(review.agent_name, "Test agent");
    assert_eq!(review.pending.len(), 1);
    let first = &review.pending[0];
    assert_eq!(first.resume_key, "each_place[0]/approve");
    assert_eq!(first.step_title.as_deref(), Some("Ask me before sending"));
    assert_eq!(first.prompt.as_deref(), Some("Send to [PLACE 1]?"));
    assert_eq!(first.fields[0].name, "message");
    assert_eq!(first.fields[0].default_value, json!("Hello one"));
    let action_ids: Vec<&str> = first.actions.iter().map(|action| action.id.as_str()).collect();
    assert_eq!(action_ids, ["send", "skip"]);
    let container = first.container.as_ref().unwrap();
    assert_eq!(container.title.as_deref(), Some("For each place"));
    assert_eq!((container.index, container.total, container.finished), (0, Some(2), Some(0)));
    assert_eq!(container.item, Some(json!({"name": "[PLACE 1]"})));
    assert!(review.answered.is_empty());
    assert_eq!(latest_pending_review(&harness.db).unwrap().map(|latest| latest.run_id), Some(run.id.clone()));

    let answer = json!({"action": "send", "values": {"message": "Hello one"}});
    harness.runs.resume_run(&run.id, json!({ first.resume_key.clone(): answer })).await.unwrap();
    wait_for_status_count(&harness.sink, &run.id, RunStatus::Paused, 2).await;

    let second_review = get_run_review(&harness.db, &run.id).unwrap();
    assert_eq!(second_review.pending.len(), 1);
    let second = &second_review.pending[0];
    assert_eq!(second.resume_key, "each_place[1]/approve");
    assert_eq!(second.prompt.as_deref(), Some("Send to [PLACE 2]?"));
    assert_eq!(second.container.as_ref().and_then(|position| position.finished), Some(1));
    assert_eq!(second_review.answered.len(), 1);
    assert_eq!((second_review.answered[0].action.as_str(), second_review.answered[0].index), ("send", Some(0)));
    // The button is named the way the question wrote it, not by its id.
    assert_eq!(second_review.answered[0].action_title.as_deref(), Some("Send"));

    let skip = json!({"action": "skip", "values": {"message": "Hello two"}});
    harness.runs.resume_run(&run.id, json!({ second.resume_key.clone(): skip })).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let finished = get_run_review(&harness.db, &run.id).unwrap();
    assert!(finished.pending.is_empty());
    assert_eq!(finished.answered.len(), 2);
    assert_eq!(harness.db.get_run(&run.id).unwrap().outputs, Some(json!({"decisions": ["send", "skip"]})));
    assert_eq!(latest_pending_review(&harness.db).unwrap(), None);
}

#[tokio::test]
async fn parallel_iteration_waits_on_every_item_at_once() {
    let harness = harness_with_answers(&["Draft", "Draft"]);
    let agent = create_agent(&harness.db, &review_each_flow(true));
    let run = harness.runs.start_run(&agent.id, RunTrigger::Schedule, places_input()).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Paused).await;

    let review = get_run_review(&harness.db, &run.id).unwrap();
    let mut keys: Vec<String> = review.pending.iter().map(|pending| pending.resume_key.clone()).collect();
    keys.sort();
    assert_eq!(keys, ["each_place[0]/approve", "each_place[1]/approve"]);

    let answers: serde_json::Map<String, serde_json::Value> =
        keys.iter().map(|key| (key.clone(), json!({"action": "send", "values": {"message": "Draft"}}))).collect();
    harness.runs.resume_run(&run.id, serde_json::Value::Object(answers)).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    assert_eq!(harness.db.get_run(&run.id).unwrap().outputs, Some(json!({"decisions": ["send", "send"]})));
}

#[tokio::test]
async fn last_run_inputs_prefill_the_next_run() {
    let harness = harness_with_answers(&["Answer"]);
    let agent = create_agent(&harness.db, SIMPLE_ANSWER);
    assert_eq!(harness.db.get_last_run_inputs(&agent.id).unwrap(), None);
    let run = harness.runs.start_run(&agent.id, RunTrigger::Test, json!({"question": "[QUESTION]"})).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;
    assert_eq!(harness.db.get_last_run_inputs(&agent.id).unwrap(), Some(json!({"question": "[QUESTION]"})));
    assert!(get_run_review(&harness.db, &run.id).unwrap().pending.is_empty());
}
