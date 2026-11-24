//! `file` / `file-list` start inputs: paths the user chose in the app become
//! graphrt files; the same paths from other callers stay text and are refused.

use super::*;

const FILE_INPUT_FLOW: &str = r#"
version: "1"
name: file-input
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: invoice, type: file, required: true, label: Invoice }
        - { variable: photos, type: file-list, label: Photos }
    - id: end
      type: end
      outputs:
        - { variable: invoice, value_selector: [start, invoice] }
        - { variable: photos, value_selector: [start, photos] }
  edges:
    - { source: start, target: end }
"#;

fn chosen_inputs(dir: &tempfile::TempDir) -> serde_json::Value {
    let invoice_path = dir.path().join("Invoice.pdf");
    let photo_path = dir.path().join("cat.png");
    std::fs::write(&invoice_path, b"%PDF-1.4").unwrap();
    std::fs::write(&photo_path, b"png").unwrap();
    json!({ "invoice": invoice_path, "photos": [photo_path] })
}

#[tokio::test]
async fn files_chosen_in_the_app_reach_the_flow_as_files() {
    let harness = harness_with_answers(&[]);
    let agent = create_agent(&harness.db, FILE_INPUT_FLOW);
    let dir = tempfile::tempdir().unwrap();

    let run = harness.runs.start_run_with_chosen_files(&agent.id, RunTrigger::Test, chosen_inputs(&dir)).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Succeeded).await;

    let outputs = harness.db.get_run(&run.id).unwrap().outputs.unwrap();
    assert_eq!(outputs["invoice"]["$file"], json!(true));
    assert_eq!(outputs["invoice"]["name"], json!("Invoice.pdf"));
    assert_eq!(outputs["invoice"]["transfer"], json!("local_file"));
    assert_eq!(outputs["photos"][0]["name"], json!("cat.png"));
}

#[tokio::test]
async fn paths_from_other_callers_are_not_turned_into_files() {
    let harness = harness_with_answers(&[]);
    let agent = create_agent(&harness.db, FILE_INPUT_FLOW);
    let dir = tempfile::tempdir().unwrap();

    let run = harness.runs.start_run(&agent.id, RunTrigger::Schedule, chosen_inputs(&dir)).await.unwrap();
    wait_for_status(&harness.sink, &run.id, RunStatus::Failed).await;
}

#[tokio::test]
async fn a_missing_chosen_file_is_refused_before_a_run_is_recorded() {
    let harness = harness_with_answers(&[]);
    let agent = create_agent(&harness.db, FILE_INPUT_FLOW);
    let dir = tempfile::tempdir().unwrap();
    let missing_path = dir.path().join("gone.pdf");

    let error = harness
        .runs
        .start_run_with_chosen_files(&agent.id, RunTrigger::Test, json!({ "invoice": missing_path }))
        .await
        .unwrap_err();

    assert!(matches!(&error, AppError::InvalidInput(message) if message.contains("Invoice")), "{error:?}");
    assert!(harness.db.list_runs(&RunFilter::default()).unwrap().is_empty());
}
