//! The pipeline on a real OpenAI model: suggested tests, a check of a chatbot that misses a
//! fact, the blocked release, a fixed version that passes, its release and going back.
//!
//! Not part of the normal test run (`#[ignore]`). The key is read from the file named by
//! `GRAPHRT_LIVE_OPENAI_KEY_FILE` into an in-memory credential store; it is never printed.
//!
//! ```sh
//! GRAPHRT_LIVE_OPENAI_KEY_FILE=~/.config/graphrt-secrets/openai.key \
//!   cargo test --manifest-path src-tauri/Cargo.toml quality::live_check -- --ignored --nocapture
//! ```

use std::sync::Arc;

use super::release::ReleaseReadiness;
use super::view::CheckView;
use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::KeychainModelRegistrySource;
use crate::skills::DefaultDraftModel;
use crate::storage::models::NewAgent;
use crate::storage::Database;

#[derive(Debug)]
struct Printed;

impl CheckProgressSink for Printed {
    fn send(&self, progress: CheckProgress) {
        if progress.finished {
            println!("  check finished ({} answers)", progress.total);
        }
    }
}

fn chatbot_flow(facts: &str) -> String {
    format!(
        r#"version: "1"
name: toko-kue
graph:
  nodes:
    - id: start
      type: start
      variables:
        - {{ variable: message, type: paragraph, required: true }}
    - id: reply
      type: llm
      model: {{ provider: openai, name: gpt-4o-mini, completion_params: {{ temperature: 0 }} }}
      prompt_template:
        - role: system
          text: "Kamu asisten Toko Kue Rina. Jawab singkat dan sopan dalam bahasa pelanggan. Pakai hanya fakta ini. {facts} Kalau tidak tahu, bilang akan ditanyakan ke admin."
        - {{ role: user, text: "{{{{#start.message#}}}}" }}
    - id: answer
      type: answer
      answer: "{{{{#reply.text#}}}}"
  edges:
    - {{ source: start, target: reply }}
    - {{ source: reply, target: answer }}
"#
    )
}

const FACTS_V1: &str = "Buka Senin sampai Sabtu jam 08.00 sampai 17.00, Minggu tutup. Nastar Rp 120.000 per toples.";
const FACTS_V2: &str = "Buka Senin sampai Sabtu jam 08.00 sampai 17.00, Minggu tutup. Nastar Rp 120.000 per toples. \
                        Kami antar ke seluruh Jakarta Selatan, gratis ongkir untuk minimal 3 toples.";

fn print_check(label: &str, check: &CheckView) {
    println!("{label}: {} of {} good (needs {}), enough: {}", check.good, check.total, check.needed, check.enough_good);
    for question in &check.questions {
        let mark = if question.good { "GOOD" } else { "NOT GOOD" };
        let change = question.change.map(|change| format!(" [{change:?}]")).unwrap_or_default();
        println!("  {mark}{change}  {}\n      answer: {}", question.question, question.answer.replace('\n', " "));
        if let Some(why) = &question.good_because {
            println!("      why: {why}");
        }
        for reason in &question.not_good_because {
            println!("      why not: {reason:?}");
        }
    }
}

#[tokio::test]
#[ignore = "needs a real OpenAI key in GRAPHRT_LIVE_OPENAI_KEY_FILE"]
async fn live_check_and_release_with_openai() {
    let Some(key_file) = std::env::var_os("GRAPHRT_LIVE_OPENAI_KEY_FILE") else {
        panic!("set GRAPHRT_LIVE_OPENAI_KEY_FILE to the file with the OpenAI key");
    };
    let key = std::fs::read_to_string(key_file).expect("the key file can be read");
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, key.trim()).unwrap();
    drop(key);
    let agent = db
        .create_agent(NewAgent {
            name: "Asisten Toko Kue Rina".into(),
            kind: AgentKind::Chatbot,
            description: "Menjawab pertanyaan pelanggan Toko Kue Rina soal jam buka, harga dan pengiriman".into(),
            flow_yaml: chatbot_flow(FACTS_V1),
        })
        .unwrap();
    let service = QualityService::new(
        CheckDependencies {
            db: db.clone(),
            credentials: credentials.clone(),
            model_source: Arc::new(KeychainModelRegistrySource),
            agent_files: None,
        },
        Arc::new(DefaultDraftModel { db: db.clone(), credentials }),
        Arc::new(Printed),
    );
    let id = agent.id.as_str();

    let suggested = service.suggest_tests(id).await.expect("the model suggests tests");
    println!("suggested {} tests:", suggested.len());
    for test in &suggested {
        println!("  - {} => {}", test.question, test.good_answer);
    }
    assert!(!suggested.is_empty());

    let test = |question: &str, good_answer: &str| TestInput {
        question: question.into(),
        good_answer: good_answer.into(),
        ..TestInput::default()
    };
    service
        .add_tests(
            id,
            vec![
                test("Hari Minggu buka nggak?", "Tidak, hari Minggu tutup."),
                test("Jam berapa tokonya buka hari Senin?", "Buka jam 08.00 sampai 17.00."),
                test("Berapa harga nastar?", "Rp 120.000 per toples."),
                test(
                    "Bisa antar ke Jakarta Selatan?",
                    "Bisa, diantar ke Jakarta Selatan, gratis ongkir minimal 3 toples.",
                ),
                test("Ongkirnya berapa kalau beli 3 toples?", "Gratis ongkir untuk 3 toples atau lebih."),
            ],
        )
        .unwrap();

    let first = service.run_check_now(id).await.expect("the first check runs");
    print_check("version 1", &first);
    let overview = service.overview(id).unwrap();
    println!("release of version 1: {:?}", overview.readiness);
    let first_blocked = matches!(overview.readiness, ReleaseReadiness::Blocked { .. });
    if first_blocked {
        let refused = service.create_release(id, "Versi pertama", None).unwrap_err();
        println!("release refused: {refused}");
    }

    db.update_agent_flow(id, &chatbot_flow(FACTS_V2), "Tambah info pengiriman").unwrap();
    let second = service.run_check_now(id).await.expect("the second check runs");
    print_check("version 2", &second);
    assert!(second.good >= first.good, "the version with the delivery facts does at least as well");
    let overview = service.overview(id).unwrap();
    println!("release of version 2: {:?}", overview.readiness);
    let release = match overview.readiness {
        ReleaseReadiness::Ready { .. } => service.create_release(id, "Tambah info pengiriman", None).unwrap(),
        ReleaseReadiness::Blocked { .. } => {
            service.create_release(id, "Tambah info pengiriman", Some("live test: model varied".into())).unwrap()
        }
    };
    println!(
        "released: release {} of version {} (override: {:?})",
        release.number, release.agent_version, release.override_reason
    );
    assert_eq!(db.released_agent(id).unwrap().current_version, 2);
    if first_blocked {
        println!("version 1 was blocked as expected");
    }
}
