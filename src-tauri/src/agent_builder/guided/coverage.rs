//! What the guided path covers, and the checks that keep it honest.
//!
//! A plan can write, look things up, ask the person, use a plugin operation and carry a
//! schedule. It cannot repeat over a list or work on files, and it can only act outside
//! the app through an operation it was offered.
//!
//! The plan carries its own evidence: the words of the job that say it sends something,
//! runs on a schedule, repeats for each item of a list or works on files
//! ([`JobWords`]). The model copies them; the app keeps a quote only when the job holds it
//! ([`verify_job_words`]). So the checks need no word list and work in any language, and a
//! small model cannot claim a schedule or a sending step the job never asked for. A small
//! model asked "does this job send something?" answers yes for plain writing jobs, which is
//! why it is asked for the words, never for a yes or a no.
//!
//! One word list is left, for the full path, which has no plan: the schedule words a
//! drafted document cannot carry ([`schedule_in_words`]).

use super::plan::{JobWords, Plan, PlanInput, PlanStep, Repeat, Schedule};
use crate::credentials::{ModelChoice, ModelProvider};
use crate::storage::models::AgentKind;

/// Words that start "for each one of a list" unless a time word follows ("every morning").
const EACH_WORDS: &[&str] = &["each", "every", "setiap", "tiap"];

const TIME_WORDS: &[&str] = &[
    "day",
    "morning",
    "afternoon",
    "evening",
    "night",
    "week",
    "month",
    "hour",
    "weekday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "hari",
    "pagi",
    "siang",
    "sore",
    "malam",
    "minggu",
    "bulan",
    "jam",
    "senin",
    "selasa",
    "rabu",
    "kamis",
    "jumat",
    "sabtu",
];

/// Words that by themselves say the agent runs on a schedule.
const SCHEDULE_WORDS: &[&str] = &[
    "daily",
    "weekly",
    "hourly",
    "schedule",
    "schedules",
    "scheduled",
    "jadwal",
    "jadwalkan",
    "terjadwal",
    "harian",
    "mingguan",
];

/// Whether a new agent of `kind` (or a change to one) is planned on the guided path when
/// `model` drafts it. A job the plan cannot express ([`is_out_of_reach`]) and a job that
/// gets no usable plan are still drafted in full.
///
/// - Ollama, every kind but a team (whose `agent` steps a plan does not have): a local
///   model reads about 4,000 tokens, less than the full drafting prompt.
/// - OpenAI, task agents: measured on the same jobs with gpt-4o-mini and gpt-4o
///   (`live_eval`), the guided path built as many or more working agents for every kind of
///   job. Chatbots and chains were not measured and stay on the full path.
/// - Other providers stay on the full path until they are measured: Anthropic and Gemini
///   take a schema differently, DeepSeek's API may not take one, local CLI models answer text.
pub(in crate::agent_builder) fn takes_guided_path(model: &ModelChoice, kind: AgentKind) -> bool {
    #[cfg(test)]
    match eval_path::forced() {
        Some(eval_path::Forced::Guided) => return kind != AgentKind::Team,
        Some(eval_path::Forced::Full) => return false,
        None => {}
    }
    match model.provider {
        ModelProvider::Ollama => kind != AgentKind::Team,
        // Measured on task agents only; chatbots and chains stay on the full path until measured.
        ModelProvider::Openai => kind == AgentKind::Task,
        _ => false,
    }
}

/// The measuring harness (`live_eval`) compares both paths on the same model: it forces one.
#[cfg(test)]
pub(in crate::agent_builder) mod eval_path {
    use std::sync::atomic::{AtomicU8, Ordering};

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Forced {
        Guided,
        Full,
    }

    static FORCED: AtomicU8 = AtomicU8::new(0);

    pub fn force(path: Option<Forced>) {
        let value = match path {
            None => 0,
            Some(Forced::Guided) => 1,
            Some(Forced::Full) => 2,
        };
        FORCED.store(value, Ordering::SeqCst);
    }

    pub fn forced() -> Option<Forced> {
        match FORCED.load(Ordering::SeqCst) {
            1 => Some(Forced::Guided),
            2 => Some(Forced::Full),
            _ => None,
        }
    }
}

/// `words` with every quote the job does not hold emptied: what the model copied must be
/// the job's own words (case, spacing and the punctuation around it aside).
///
/// @example a "send" quote "send it by email" stays for the job "Write a note and send it by email."
pub(super) fn verify_job_words(words: &mut JobWords, job: &str) {
    let job = comparable(job);
    for quote in [
        &mut words.send,
        &mut words.when,
        &mut words.for_each,
        &mut words.files,
        &mut words.given,
        &mut words.hand_over,
    ] {
        let wanted = comparable(quote);
        let holds_it =
            wanted.chars().filter(|character| character.is_alphanumeric()).count() >= 3 && job.contains(&wanted);
        if !holds_it {
            quote.clear();
        }
    }
}

/// Why the job needs the full workflow format, from the plan's checked words: repeating
/// for each item of a list, working on files, or sending with no operation offered to send
/// with. `None` when a plan can do the job.
pub(super) fn out_of_reach(words: &JobWords, has_offered_operations: bool) -> Option<&'static str> {
    if !words.for_each.is_empty() {
        Some("the job repeats for each item of a list")
    } else if !words.files.is_empty() {
        Some("the job works on files")
    } else if !words.send.is_empty() && !has_offered_operations {
        Some("the job sends something and no operation can send it")
    } else {
        None
    }
}

/// A sentence for the model when its own words say the job sends something and no step
/// does; `None` when the plan does what it says.
pub(super) fn missing_action(plan: &Plan) -> Option<String> {
    let has_plugin_step = plan.steps.iter().any(|step| matches!(step, PlanStep::Use { .. }));
    (!plan.job_words.send.is_empty() && !has_plugin_step).then(|| {
        format!(
            "the job says \"{}\", but no step does it; add a \"use\" step with the operation that does it, after \
             the step that writes what is sent",
            plan.job_words.send
        )
    })
}

/// The plan's schedule, kept only when the job's own words ask for one: a small model adds
/// "daily at 10" to jobs that never said when. Words that say when without a schedule
/// mean every day at the usual hour.
pub(super) fn checked_schedule(plan: &Plan) -> Option<Schedule> {
    if plan.job_words.when.is_empty() {
        return None;
    }
    Some(plan.schedule.unwrap_or_else(Schedule::daily))
}

/// The input for the text the person gives, added to a plan whose own words say the person
/// gives one ("the notes I paste") but that has no long-text input to receive it.
pub(super) fn input_for_given_text(plan: &Plan) -> Option<PlanInput> {
    if plan.job_words.given.is_empty() || plan.inputs.iter().any(|input| input.long_text) {
        return None;
    }
    let mut name = "text".to_owned();
    while plan.inputs.iter().any(|input| input.name == name) {
        name.push('_');
    }
    let label = plan.job_words.given.clone();
    Some(PlanInput { name, label, long_text: true, value: String::new() })
}

/// Lowercase words of `text` joined by single spaces, without punctuation.
fn comparable(text: &str) -> String {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The schedule the description's own words give, for a plan that carries none: "every
/// morning" is daily at 08:00. `None` when the description names no schedule.
pub(super) fn schedule_in_words(description: &str) -> Option<Schedule> {
    let words = words(description);
    let follows_each = |time_words: &[&str]| {
        words.windows(2).any(|pair| EACH_WORDS.contains(&pair[0].as_str()) && time_words.contains(&pair[1].as_str()))
    };
    let has = |candidates: &[&str]| words.iter().any(|word| candidates.contains(&word.as_str()));
    let is_scheduled = has(SCHEDULE_WORDS) || follows_each(TIME_WORDS);
    if !is_scheduled {
        return None;
    }
    let repeat = if has(&["hourly"]) || follows_each(&["hour", "jam"]) {
        Repeat::Hourly
    } else if has(&["weekly", "mingguan"]) || follows_each(&["week", "minggu"]) {
        Repeat::Weekly
    } else if follows_each(&["weekday"]) {
        Repeat::Weekdays
    } else {
        Repeat::Daily
    };
    let hour = if has(&["evening", "afternoon", "sore"]) {
        17
    } else if has(&["night", "malam"]) {
        20
    } else {
        Schedule::daily().hour
    };
    Some(Schedule { repeat, hour })
}

/// Words that say the person hands the agent a web address.
const LINK_WORDS: &[&str] = &["link", "links", "url", "urls", "tautan", "website", "webpage"];

/// Whether the description says the person gives the agent a link to read ("the web page
/// at a link I give", "tautan yang saya kirim").
///
/// @example `gives_a_link("Summarize the page at a link I give") == true`
/// @example `gives_a_link("Look up the Wikipedia summary for Jakarta") == false`
pub(super) fn gives_a_link(description: &str) -> bool {
    let words = words(description);
    words.iter().any(|word| LINK_WORDS.contains(&word.as_str())) || has_phrase(&words, &[&["web", "page"]])
}

fn has_phrase(words: &[String], phrases: &[&[&str]]) -> bool {
    phrases.iter().any(|phrase| {
        words.windows(phrase.len()).any(|window| window.iter().map(String::as_str).eq(phrase.iter().copied()))
    })
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn plan_with(steps: Vec<PlanStep>) -> Plan {
        Plan {
            summary: String::new(),
            name: String::new(),
            inputs: Vec::new(),
            steps,
            schedule: None,
            job_words: JobWords::default(),
            job: String::new(),
        }
    }

    fn write_step() -> PlanStep {
        PlanStep::Write { title: "Write".into(), instruction: "Write it.".into() }
    }

    fn job_words(send: &str, when: &str, for_each: &str, files: &str) -> JobWords {
        JobWords {
            send: send.into(),
            when: when.into(),
            for_each: for_each.into(),
            files: files.into(),
            given: String::new(),
            hand_over: String::new(),
        }
    }

    #[test]
    fn a_text_the_job_says_the_person_gives_gets_an_input() {
        let mut plan = plan_with(vec![write_step()]);
        plan.inputs =
            vec![PlanInput { name: "text".into(), label: "Email".into(), long_text: false, value: String::new() }];
        assert_eq!(input_for_given_text(&plan), None);
        plan.job_words.given = "catatan rapat yang saya tempel".into();
        let input = input_for_given_text(&plan).unwrap();
        assert_eq!(
            (input.name.as_str(), input.label.as_str(), input.long_text),
            ("text_", "catatan rapat yang saya tempel", true)
        );
        plan.inputs.push(input);
        assert_eq!(input_for_given_text(&plan), None, "one is enough");
    }

    #[test]
    fn only_quotes_the_job_holds_are_kept() {
        let mut words = job_words("Send it by EMAIL!", "every morning", "for each customer", "the PDF");
        verify_job_words(&mut words, "Every morning write a note and send it by email.");
        assert_eq!(words, job_words("Send it by EMAIL!", "every morning", "", ""));
        // Indonesian (or any language) works the same way.
        let mut words = job_words("kirim ringkasannya lewat email", "", "", "");
        verify_job_words(
            &mut words,
            "Ringkas catatan rapat lalu kirim ringkasannya lewat email ke alamat yang saya isi",
        );
        assert_eq!(words.send, "kirim ringkasannya lewat email");
        // Too short to be evidence.
        let mut words = job_words("a", "", "", "");
        verify_job_words(&mut words, "a note");
        assert!(words.send.is_empty());
    }

    #[test]
    fn lists_files_and_sending_without_an_operation_need_the_full_format() {
        assert_eq!(out_of_reach(&job_words("", "", "", ""), false), None);
        assert!(out_of_reach(&job_words("", "", "send each one", ""), true).unwrap().contains("each item"));
        assert!(out_of_reach(&job_words("", "", "", "the file I attach"), true).unwrap().contains("files"));
        assert!(out_of_reach(&job_words("post it to Slack", "", "", ""), false).unwrap().contains("no operation"));
        assert_eq!(out_of_reach(&job_words("post it to Slack", "every day", "", ""), true), None);
    }

    #[test]
    fn a_plan_whose_words_say_send_but_that_sends_nothing_is_sent_back() {
        let mut only_writes = plan_with(vec![write_step()]);
        assert_eq!(missing_action(&only_writes), None);
        only_writes.job_words.send = "send it by email".into();
        assert!(missing_action(&only_writes).unwrap().contains("\"send it by email\""));
        let sends = Plan {
            job_words: job_words("send it by email", "", "", ""),
            ..plan_with(vec![
                write_step(),
                PlanStep::Use {
                    title: "Send".into(),
                    instruction: "Send it".into(),
                    operation: "email.send_email".into(),
                    fields: BTreeMap::new(),
                },
            ])
        };
        assert_eq!(missing_action(&sends), None);
    }

    #[test]
    fn a_schedule_stays_only_when_the_job_says_when() {
        let mut plan = plan_with(vec![write_step()]);
        plan.schedule = Some(Schedule { repeat: Repeat::Daily, hour: 10 });
        assert_eq!(checked_schedule(&plan), None, "llama3.2 added a schedule nobody asked for");
        plan.job_words.when = "every morning".into();
        assert_eq!(checked_schedule(&plan), Some(Schedule { repeat: Repeat::Daily, hour: 10 }));
        plan.schedule = None;
        assert_eq!(checked_schedule(&plan), Some(Schedule::daily()));
    }

    #[test]
    fn a_link_the_person_gives_is_told_apart_from_a_site_the_job_names() {
        assert!(gives_a_link("Read the web page at a link I give and summarize it in three bullet points"));
        assert!(gives_a_link("Ringkas halaman dari tautan yang saya kirim"));
        assert!(gives_a_link("Summarize the URL I paste"));
        assert!(!gives_a_link("Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it"));
        assert!(!gives_a_link("Write a polite reply to a customer complaint that I paste in"));
    }

    #[test]
    fn schedules_are_read_from_plain_words() {
        let daily = Schedule::daily();
        assert_eq!(schedule_in_words("Every morning tell me the weather"), Some(daily));
        assert_eq!(schedule_in_words("Setiap pagi ringkas berita"), Some(daily));
        assert_eq!(
            schedule_in_words("Send a daily report in the evening"),
            Some(Schedule { repeat: Repeat::Daily, hour: 17 })
        );
        assert_eq!(schedule_in_words("Check prices every hour"), Some(Schedule { repeat: Repeat::Hourly, hour: 8 }));
        assert_eq!(schedule_in_words("Laporan mingguan penjualan"), Some(Schedule { repeat: Repeat::Weekly, hour: 8 }));
        assert_eq!(schedule_in_words("Write a reply to every complaint I paste"), None);
        assert_eq!(schedule_in_words("Translate a text"), None);
    }

    #[test]
    fn ollama_plans_every_kind_but_a_team_and_openai_plans_tasks() {
        let local = ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() };
        for kind in [AgentKind::Task, AgentKind::Chatbot, AgentKind::Chain] {
            assert!(takes_guided_path(&local, kind), "{kind:?}");
        }
        assert!(!takes_guided_path(&local, AgentKind::Team));
        let cloud = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
        assert!(takes_guided_path(&cloud, AgentKind::Task));
        for kind in [AgentKind::Chatbot, AgentKind::Chain, AgentKind::Team] {
            assert!(!takes_guided_path(&cloud, kind), "{kind:?}");
        }
    }

    #[test]
    fn providers_not_measured_on_the_guided_path_draft_in_full() {
        for provider in [
            ModelProvider::Anthropic,
            ModelProvider::Gemini,
            ModelProvider::Deepseek,
            ModelProvider::ClaudeCodeCli,
            ModelProvider::CodexCli,
        ] {
            let model = ModelChoice { provider, name: "m".into() };
            assert!(!takes_guided_path(&model, AgentKind::Task), "{provider:?}");
        }
    }
}
