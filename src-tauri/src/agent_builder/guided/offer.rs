//! Which plugin operations a plan is offered.
//!
//! The catalog holds hundreds of operations; a local model can read a handful. The ones
//! offered are those whose plugin, name or title shares words with the job description
//! ("email" in "email me a summary" matches the email plugin). Without a match the plan
//! has no plugin step at all, which is what keeps a small model from adding a sending
//! step to a plain writing job: it cannot pick what it is not offered.

use crate::plugins::operations::OfferedOperation;

/// Most operations offered for one job.
const MAX_OFFERED: usize = 8;

/// Words that say nothing about which plugin a job needs.
const COMMON_WORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "then",
    "give",
    "paste",
    "write",
    "make",
    "get",
    "list",
    "read",
    "find",
    "send",
    "create",
    "add",
    "new",
    "all",
    "each",
    "every",
    "text",
    "message",
    "messages",
    "about",
    "what",
    "when",
    "them",
    "their",
    "your",
    "you",
    "our",
    "its",
    "one",
    "two",
    "three",
    "short",
    "summary",
    "yang",
    "dan",
    "untuk",
    "dengan",
    "dari",
    "ini",
    "itu",
    "saya",
    "kami",
    "buat",
    "buatkan",
    "tulis",
    "lalu",
    "kirim",
    "pesan",
    "setiap",
    "jadi",
    "api",
    "data",
    "file",
    "files",
    "page",
    "pages",
    "day",
    "daily",
    "web",
    "online",
    "internet",
    "link",
    "before",
    "after",
    "check",
    "value",
    "values",
    "first",
    "last",
    "finish",
    "finishing",
    "approve",
    "draft",
    "reply",
    "ask",
    "latest",
    "current",
    "today",
    "now",
];

/// Words that do not tell operations of one plugin apart.
const UNTELLING_WORDS: &[&str] = &["get", "the", "and", "for", "with", "from", "all", "new"];

/// Verbs of a job description, in the words operation names use (`kirim` → `send`).
const VERB_MEANINGS: &[(&str, &str)] = &[
    ("kirim", "send"),
    ("kirimkan", "send"),
    ("mengirim", "send"),
    ("send", "send"),
    ("sends", "send"),
    ("post", "post"),
    ("posting", "post"),
    ("baca", "read"),
    ("read", "read"),
    ("cari", "search"),
    ("search", "search"),
    ("find", "search"),
    ("daftar", "list"),
    ("list", "list"),
    ("simpan", "save"),
    ("save", "save"),
    ("tambah", "add"),
    ("add", "add"),
    ("buat", "create"),
    ("create", "create"),
    ("convert", "convert"),
    ("konversi", "convert"),
    ("ubah", "update"),
    ("update", "update"),
];

/// The operations worth showing for `description`, best match first, at most [`MAX_OFFERED`].
/// An operation is offered only when the description names its plugin, or a word of its
/// own name or title that is not a common word; among those, a matching verb and an
/// installed plugin rank higher.
pub(super) fn relevant_operations(operations: Vec<OfferedOperation>, description: &str) -> Vec<OfferedOperation> {
    let description_words = words(description);
    let verbs: Vec<&str> = description_words
        .iter()
        .filter_map(|word| VERB_MEANINGS.iter().find(|(written, _)| written == word).map(|(_, meaning)| *meaning))
        .collect();
    let mut scored: Vec<((usize, usize), OfferedOperation)> = operations
        .into_iter()
        .filter_map(|operation| {
            let plugin_words = words(&operation.plugin);
            let own_words =
                words(&format!("{} {}", operation.kind.split_once('.').map_or("", |(_, name)| name), operation.title));
            let names_plugin =
                plugin_words.iter().filter(|word| is_telling(word)).any(|word| has_word(&description_words, word));
            let names_operation =
                own_words.iter().filter(|word| is_telling(word)).any(|word| has_word(&description_words, word));
            // A word of the operation alone ("rate", "items", "translate") is enough only for a
            // plugin that needs no setting up: a plain writing job must not end up needing a
            // HubSpot token because its notes have "action items", nor a web page a browser.
            if !(names_plugin || (names_operation && !operation.needs_setup)) {
                return None;
            }
            let verb_matches = verbs.iter().any(|verb| own_words.iter().any(|word| word == verb));
            let score = usize::from(names_plugin) * 4
                + usize::from(names_operation) * 2
                + usize::from(verb_matches) * 3
                + usize::from(operation.installed) * 2;
            // Among equals, the operation whose own words the job uses most ("page summary").
            let shared_words = own_words
                .iter()
                .filter(|word| word.chars().count() >= 3 && !UNTELLING_WORDS.contains(&word.as_str()))
                .filter(|word| has_word(&description_words, word))
                .collect::<std::collections::BTreeSet<_>>()
                .len();
            Some(((score, shared_words), operation))
        })
        .collect();
    // Stable: operations with the same score keep the plugin's own order.
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    scored.into_iter().take(MAX_OFFERED).map(|(_, operation)| operation).collect()
}

fn is_telling(word: &str) -> bool {
    word.chars().count() >= 3 && !COMMON_WORDS.contains(&word)
}

/// Whether `words` holds `word`, also as a plural ("emails" names "email").
fn has_word(words: &[String], word: &str) -> bool {
    words.iter().any(|candidate| candidate == word || candidate.strip_suffix('s') == Some(word))
}

/// Lowercase words of a description or of a name such as `google-sheets` or `send_email`.
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
    use crate::plugins::operations::OperationField;

    fn operation(kind: &str, title: &str, installed: bool) -> OfferedOperation {
        OfferedOperation {
            kind: kind.to_owned(),
            plugin: kind.split_once('.').map_or(kind, |(plugin, _)| plugin).to_owned(),
            title: title.to_owned(),
            description: String::new(),
            installed,
            sends: kind.contains("send") || kind.contains("post"),
            needs_setup: !kind.starts_with("currency-rates"),
            fields: Vec::<OperationField>::new(),
        }
    }

    fn catalog() -> Vec<OfferedOperation> {
        vec![
            operation("email.list_messages", "List email messages", false),
            operation("email.send_email", "Send email", false),
            operation("slack.post_message", "Post message", false),
            operation("slack.list_users", "List users", false),
            operation("currency-rates.get_pair_rate", "Get pair rate", true),
            operation("google-sheets.append_row", "Append row", false),
        ]
    }

    fn offered(description: &str) -> Vec<String> {
        relevant_operations(catalog(), description).into_iter().map(|operation| operation.kind).collect()
    }

    #[test]
    fn a_job_that_names_a_plugin_is_offered_its_operations_with_the_matching_verb_first() {
        assert_eq!(offered("Write a thank-you note and send it by email"), ["email.send_email", "email.list_messages"]);
        assert_eq!(offered("Kirim ringkasan rapat lewat email ke tim"), ["email.send_email", "email.list_messages"]);
        assert_eq!(offered("Post a daily quote to our Slack channel"), ["slack.post_message", "slack.list_users"]);
        assert_eq!(offered("Add each order to my Google Sheets"), ["google-sheets.append_row"]);
    }

    #[test]
    fn a_plain_writing_job_is_offered_nothing() {
        for description in [
            "Write a polite reply to a customer complaint that I paste in",
            "Translate the text I give into Indonesian and make it sound formal",
            "Take my meeting notes and turn them into a list of action items with owners",
            "Send me three caption ideas",
            "Ringkas artikel yang saya tempel jadi tiga poin",
        ] {
            assert!(offered(description).is_empty(), "{description}: {:?}", offered(description));
        }
    }

    #[test]
    fn among_one_plugins_operations_the_one_the_job_describes_comes_first() {
        let wikipedia = vec![
            operation("wikipedia.search_pages", "Search pages", false),
            operation("wikipedia.get_page_summary", "Get page summary", false),
            operation("wikipedia.get_page_content", "Get page content", false),
        ];
        let offered = relevant_operations(wikipedia, "Look up the Wikipedia page summary for Jakarta");
        assert_eq!(offered[0].kind, "wikipedia.get_page_summary");
    }

    #[test]
    fn a_word_of_an_operation_that_needs_an_account_is_not_enough() {
        let hubspot = vec![operation("hubspot.get_item_list", "Get item list", false)];
        let deepl = vec![operation("deepl.translate_text", "Translate text", false)];
        assert!(relevant_operations(hubspot, "Turn my meeting notes into a list of action items").is_empty());
        assert!(relevant_operations(deepl.clone(), "Translate the text I give into Indonesian").is_empty());
        assert_eq!(relevant_operations(deepl, "Translate it with DeepL").len(), 1);
    }

    #[test]
    fn a_web_page_names_no_web_plugin() {
        let web_search = vec![operation("web-search.search", "Search the web", false)];
        assert!(relevant_operations(web_search, "Read the web page at a link I give and summarize it").is_empty());
    }

    #[test]
    fn a_word_of_the_operation_itself_is_enough() {
        assert_eq!(offered("What is the dollar to rupiah rate today?"), ["currency-rates.get_pair_rate"]);
    }

    #[test]
    fn at_most_a_handful_are_offered() {
        let many: Vec<OfferedOperation> =
            (0..30).map(|index| operation(&format!("email.read_folder_{index}"), "Read folder", false)).collect();
        assert_eq!(relevant_operations(many, "check my email").len(), MAX_OFFERED);
    }
}
