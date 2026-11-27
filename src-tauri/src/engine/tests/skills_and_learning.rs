//! A skill drafted in the app and a note the owner approved both reach a test run.
//!
//! These are the two paths a business owner follows on the Skills and Learned screens,
//! end to end through the real services: the wizard's calls, the agent's saved steps and
//! a run of the engine. Only the model is scripted.

use graphrt_llm::text_model::ChatTextModel;

use super::*;
use crate::agent_graph::{self, GraphContext};
use crate::learning::models::{LessonDecision, RunFeedback};
use crate::learning::LearningService;
use crate::plugins::tests::SkillCatalogFixture;
use crate::skills::models::{AuthoredSkillInput, SkillDraftSource};
use crate::skills::{DraftModelSource, SkillService};

const HELPER_FLOW: &str = r#"
version: "1"
name: support-desk
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: paragraph, required: true }] }
    - id: helper
      type: agent
      title: Answer the customer
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.question#}}"
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [helper, text], value_type: string }] }
  edges:
    - { source: start, target: helper }
    - { source: helper, target: end }
"#;

/// What a model writes when asked for a draft: a description that says when to use the
/// skill, as the runtime's drafting prompt asks for.
const DRAFT_ANSWER: &str = "---\nname: refund-requests\ndescription: Use when a customer asks for a refund or their money back.\n---\n\n# Refund requests\n\n1. Ask for the order number.\n2. End the reply with Ref code: KIWI-14.";

#[derive(Debug)]
struct ScriptedDrafts(Arc<MockModel>);

impl DraftModelSource for ScriptedDrafts {
    fn text_model(&self) -> AppResult<Arc<dyn graphrt_core::text_model::TextModel>> {
        Ok(Arc::new(ChatTextModel::new(self.0.clone() as Arc<dyn ChatModel>, "draft-model")))
    }
}

/// Everything the model was told in one request, as text.
fn told(request: &ChatRequest) -> String {
    format!("{request:?}")
}

// One test on purpose: the skill store and the lesson store runs read from are published
// for the whole process (`skills::active`, `learning::active`), so two tests publishing
// their own would see each other's.
#[tokio::test]
async fn a_drafted_skill_is_loaded_and_an_approved_note_is_read_on_the_next_test_run() {
    // The agent's model: on the first run it loads the skill, then answers. On the second
    // run it answers at once.
    let agent_model = Arc::new(MockModel::new(vec![
        MockModel::tool_calls(&[("call-1", "load_skill", r#"{"name":"refund-requests"}"#)]),
        MockModel::text("Could you share your order number? Ref code: KIWI-14"),
        MockModel::text("Could you share your order number? We open at 9 on Monday. Ref code: KIWI-14"),
    ]));
    let harness = harness_with_model(agent_model.clone());
    let agent = create_agent(&harness.db, HELPER_FLOW);
    let registry = crate::flow::draft_node_registry();
    let context = GraphContext::new(&registry);

    // "Create a skill": the model drafts it, the person keeps it as written and saves it.
    let catalog = SkillCatalogFixture::new();
    let draft_model = Arc::new(ScriptedDrafts(Arc::new(MockModel::new(vec![MockModel::text(DRAFT_ANSWER)]))));
    let skills = SkillService::new(catalog.app_data.path(), catalog.service.clone(), draft_model.clone());
    let source =
        SkillDraftSource::Description { text: "When a customer asks for a refund, ask for the order number".into() };
    let draft = skills.draft_skill(&source).await.unwrap();
    let input = AuthoredSkillInput {
        name: None,
        title: draft.title,
        description: draft.description,
        instructions: draft.instructions,
        requested_tools: draft.requested_tools,
    };
    let review = skills.review_authored_skill(&input).unwrap();
    let installed = skills.install_authored_skill(&input, &review.review_id, &[], false).unwrap();
    assert_eq!(installed.name, "refund-requests");
    skills.activate();
    agent_graph::skills::set_step_skills(
        &harness.db,
        &agent.id,
        "helper",
        std::slice::from_ref(&installed.name),
        &context,
    )
    .unwrap();

    // "What this agent learned", with "Use what it learned" on.
    let learning =
        LearningService::new(catalog.app_data.path(), harness.db.clone(), harness.credentials.clone(), draft_model);
    learning.activate();
    agent_graph::learning::set_learning_use(&harness.db, &agent.id, true, &context).unwrap();

    // First test run: the agent is offered the skill by the line that says when to use
    // it, loads it, and only then knows the steps.
    let question = json!({ "question": "Hi, I bought a blender last week and I want a refund." });
    let first = harness.runs.start_run(&agent.id, RunTrigger::Test, question.clone()).await.unwrap();
    wait_for_status(&harness.sink, &first.id, RunStatus::Succeeded).await;
    let requests = agent_model.requests();
    assert_eq!(requests.len(), 2, "one call that loads the skill, one that answers");
    let offered = told(&requests[0]);
    assert!(
        offered.contains("refund-requests: Use when a customer asks for a refund or their money back."),
        "{offered}"
    );
    assert!(offered.contains("load_skill"), "the agent can load the skill: {offered}");
    assert!(!offered.contains("KIWI-14"), "the steps are not known before the skill is loaded: {offered}");
    let after_loading = told(&requests[1]);
    assert!(after_loading.contains("End the reply with Ref code: KIWI-14."), "{after_loading}");
    assert!(!stored_event_types(&harness.db, &first.id).contains(&"lessons_applied".to_owned()), "nothing learned yet");
    let events = serde_json::to_string(&harness.db.list_run_events(&first.id).unwrap()).unwrap();
    assert!(events.contains("load_skill"), "the run shows that the skill was loaded: {events}");

    // Thumbs down with a comment: a note that waits. The next run would not read it.
    let feedback = RunFeedback { helpful: false, comment: Some("Mention that we open at 9 on Monday".into()) };
    let outcome = learning.record_feedback(&first.id, &feedback).await.unwrap();
    let note = outcome.proposed.first().expect("the comment waits as a note").clone();
    assert_eq!(note.status, graphrt_learn::LessonStatus::Proposed);

    // The owner approves it. The next run reads it and says so.
    learning.decide(&agent.id, &note.id, LessonDecision::Approve).unwrap();
    let second = harness.runs.start_run(&agent.id, RunTrigger::Test, question).await.unwrap();
    wait_for_status(&harness.sink, &second.id, RunStatus::Succeeded).await;
    let requests = agent_model.requests();
    let with_note = told(requests.last().expect("the second run asked the model"));
    assert!(with_note.contains("Mention that we open at 9 on Monday"), "{with_note}");
    let events = serde_json::to_string(&harness.db.list_run_events(&second.id).unwrap()).unwrap();
    assert!(
        events.contains("lessons_applied") && events.contains(&note.id),
        "the run names the note it used: {events}"
    );
    let answer = harness.db.get_run(&second.id).unwrap().outputs.unwrap();
    assert_eq!(answer["result"], json!("Could you share your order number? We open at 9 on Monday. Ref code: KIWI-14"));

    // Unpublish, so no later test in this process reads these stores.
    crate::skills::unpublish_for_tests();
    crate::learning::unpublish_for_tests();
}
