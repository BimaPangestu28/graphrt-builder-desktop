use super::*;
use crate::storage::models::NewAgent;

fn create_agent(db: &Database, name: &str, kind: AgentKind, flow_yaml: &str) -> Agent {
    db.create_agent(NewAgent {
        name: name.into(),
        kind,
        description: format!("{name} job"),
        flow_yaml: flow_yaml.into(),
    })
    .unwrap()
}

fn qualifier_flow() -> String {
    r#"
version: "1"
name: qualifier
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: place, type: paragraph, required: true, label: Place }
    - id: score
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Score {{#start.place#}}" }
    - id: end
      type: end
      outputs:
        - { variable: score, value_selector: [score, text] }
  edges:
    - { source: start, target: score }
    - { source: score, target: end }
"#
    .into()
}

fn caller_flow(tool_node: &str) -> String {
    format!(
        r#"
version: "1"
name: caller
graph:
  nodes:
    - {{ id: start, type: start, variables: [] }}
{tool_node}
    - {{ id: end, type: end, outputs: [] }}
  edges:
    - {{ source: start, target: call }}
    - {{ source: call, target: end }}
"#
    )
}

fn team_flow(tools: &str) -> String {
    format!(
        r#"
version: "1"
name: team
graph:
  nodes:
    - {{ id: start, type: start, variables: [{{ variable: goal, type: paragraph }}] }}
    - id: coordinator
      type: agent
      model: {{ provider: openai, name: gpt-4o-mini }}
      query: "{{{{#start.goal#}}}}"
      tools: {tools}
    - {{ id: end, type: end, outputs: [{{ variable: text, value_selector: [coordinator, text] }}] }}
  edges:
    - {{ source: start, target: coordinator }}
    - {{ source: coordinator, target: end }}
"#
    )
}

const APPROVAL_FLOW: &str = r#"
version: "1"
name: asks
graph:
  nodes:
    - { id: start, type: start, variables: [] }
    - id: ask
      type: human-input
      prompt: "Go?"
      actions: [{ id: go, title: Go }]
    - { id: end, type: end, outputs: [] }
  edges:
    - { source: start, target: ask }
    - { source: ask, target: end, handle: go }
"#;

#[test]
fn catalog_lists_signatures_usage_and_unusable_agents() {
    let db = Database::open_in_memory().unwrap();
    let qualifier = create_agent(&db, "Qualifier", AgentKind::Task, &qualifier_flow());
    let tool_node = format!(
        "    - {{ id: call, type: tool, provider_id: agents, tool_name: {}, arguments: {{ place: cafe }} }}",
        qualifier.id
    );
    create_agent(&db, "Caller", AgentKind::Task, &caller_flow(&tool_node));
    let asking = create_agent(&db, "Asker", AgentKind::Task, APPROVAL_FLOW);
    create_agent(&db, "Broken", AgentKind::Task, "nodes: []");

    let catalog = list_agent_steps(&db).unwrap();
    let qualifier_step = catalog.iter().find(|step| step.agent_id == qualifier.id).unwrap();
    assert_eq!(qualifier_step.outputs, ["score"]);
    assert_eq!(qualifier_step.inputs[0].name, "place");
    assert_eq!(qualifier_step.used_by_count, 1);
    assert!(qualifier_step.usable_as_step);
    let asking_step = catalog.iter().find(|step| step.agent_id == asking.id).unwrap();
    assert!(!asking_step.usable_as_step);
    assert_eq!(asking_step.unusable_reason.as_deref(), Some(APPROVAL_NOT_SUPPORTED_MESSAGE));
    let broken_step = catalog.iter().find(|step| step.name == "Broken").unwrap();
    assert!(!broken_step.usable_as_step);

    assert!(matches!(ensure_usable_as_step(&db, &qualifier.id, &qualifier.id), Err(AppError::InvalidInput(_))));
    assert!(matches!(ensure_usable_as_step(&db, &qualifier.id, &asking.id), Err(AppError::InvalidInput(_))));
    assert_eq!(ensure_usable_as_step(&db, &asking.id, &qualifier.id).unwrap().id, qualifier.id);
}

#[test]
fn team_members_are_the_coordinator_agent_tools() {
    let db = Database::open_in_memory().unwrap();
    let researcher = create_agent(&db, "Researcher", AgentKind::Task, &qualifier_flow());
    let writer = create_agent(&db, "Writer", AgentKind::Task, &qualifier_flow());
    let tools = format!("[agents/{}, {{ provider: agents, name: {} }}, agents/ghost]", researcher.id, writer.id);
    let team = create_agent(&db, "Sales team", AgentKind::Team, &team_flow(&tools));

    let overview = team_overview(&db, &team.id).unwrap();
    assert_eq!(overview.coordinator_step_id.as_deref(), Some("coordinator"));
    let member_names: Vec<&str> = overview.members.iter().map(|member| member.name.as_str()).collect();
    assert_eq!(member_names, ["Researcher", "Writer"]);
    assert!(overview.members[0].latest_run.is_none());

    let everyone = create_agent(&db, "Everyone", AgentKind::Team, &team_flow("[agents/*]"));
    let everyone_overview = team_overview(&db, &everyone.id).unwrap();
    assert_eq!(everyone_overview.members.len(), 3, "every agent except the team itself");
    assert!(everyone_overview.members.iter().all(|member| member.agent_id != everyone.id));
}

#[test]
fn instructions_name_the_provider_tool_and_inputs() {
    let db = Database::open_in_memory().unwrap();
    let qualifier = create_agent(&db, "Lead \"qualifier\"", AgentKind::Task, &qualifier_flow());
    let signature = read_signature(&qualifier.flow_yaml).unwrap();
    let step_instruction = add_step_instruction(&qualifier, &signature, Some("after Search Google Maps"));
    assert!(step_instruction.contains("provider_id: agents"));
    assert!(step_instruction.contains(&format!("tool_name: {}", qualifier.id)));
    assert!(step_instruction.contains("`place` (required)"));
    assert!(step_instruction.contains("after Search Google Maps"));
    assert!(step_instruction.contains("{{#<step id>.json.<output>#}}"));
    assert!(step_instruction.contains(r#"title: "Run Lead \"qualifier\"""#));

    let member_instruction = add_team_member_instruction(&qualifier, Some("coordinator"));
    assert!(member_instruction.contains(&format!("`agents/{}`", qualifier.id)));
    assert!(member_instruction.contains("`coordinator`"));
}
