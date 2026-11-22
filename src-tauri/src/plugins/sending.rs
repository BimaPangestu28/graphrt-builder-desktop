//! Which plugin operations (node kinds `plugin.operation` and agent tools) send
//! or change something in the outside world, so the approval check treats them
//! like a writing HTTP request.
//!
//! Neither the graphrt-plugins manifests (`graphrt-plugin.json`: nodes have
//! `kind`, `title`, `description`, `category`, `config_schema`, `outputs`;
//! tools have `name`, `description`, `parameters`) nor graphrt's plugin
//! catalog carry a "sends" / side-effect flag, so the classification reads the
//! operation name. It is conservative: an operation counts as reading only
//! when its first word is a known reading (or local computing) verb and no
//! word of its name is a sending verb. Anything else, including a name the
//! lists do not know, counts as sending.

/// First words of operations that only read or compute (`get_status`, `search_places`).
const READING_VERBS: &[&str] = &[
    "get",
    "list",
    "search",
    "find",
    "read",
    "fetch",
    "lookup",
    "look",
    "count",
    "describe",
    "download",
    "check",
    "verify",
    "validate",
    "detect",
    "extract",
    "transcribe",
    "translate",
    "ocr",
    "parse",
    "analyze",
    "analyse",
    "estimate",
    "calculate",
    "compute",
    "show",
    "stat",
    "stats",
    "scan",
    "explain",
    "probe",
    "ping",
    "head",
    "inspect",
    "view",
    "preview",
    "resolve",
    "geocode",
    "summarize",
    "classify",
    "rank",
    "embed",
    "echo",
];

/// Verbs that make an operation sending wherever they appear in its name
/// (`get_and_send`, `search_then_reply`). Nouns such as `message`, `email`,
/// `comment` or `post` are left out here because they also name what a reading
/// operation reads (`get_message`); as a first word they already count as
/// sending, since they are not reading verbs.
const SENDING_WORDS: &[&str] = &[
    "send",
    "publish",
    "notify",
    "dispatch",
    "reply",
    "upload",
    "create",
    "update",
    "delete",
    "remove",
    "write",
    "put",
    "patch",
    "insert",
    "upsert",
    "edit",
    "modify",
    "mutate",
    "cancel",
    "refund",
    "pay",
    "charge",
    "transfer",
    "invite",
    "approve",
    "submit",
    "execute",
    "tweet",
    "repost",
    "broadcast",
    "forward",
    "push",
    "sync",
    "invoke",
    "trigger",
    "share",
];

/// Whether a plugin node kind (`whatsapp-api.send_text`) sends or changes
/// something. Kinds without a `plugin.` prefix are not plugin kinds.
pub fn is_sending_plugin_kind(kind: &str) -> bool {
    kind.split_once('.').is_some_and(|(_, operation)| is_sending_operation(operation))
}

/// Whether a plugin, MCP or other tool operation name sends or changes
/// something; names that are not clearly reading count as sending.
pub fn is_sending_operation(operation: &str) -> bool {
    let words = operation_words(operation);
    let Some(first_word) = words.first() else { return true };
    let reads = READING_VERBS.contains(&first_word.as_str());
    !reads || words.iter().any(|word| SENDING_WORDS.contains(&word.as_str()))
}

/// Lowercase words of `send_text`, `sendText`, `send-text` or `messages.send`.
fn operation_words(operation: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut previous_lowercase = false;
    for character in operation.chars() {
        if !character.is_ascii_alphanumeric() {
            push_word(&mut words, &mut current);
            previous_lowercase = false;
            continue;
        }
        if character.is_ascii_uppercase() && previous_lowercase {
            push_word(&mut words, &mut current);
        }
        previous_lowercase = character.is_ascii_lowercase() || character.is_ascii_digit();
        current.push(character.to_ascii_lowercase());
    }
    push_word(&mut words, &mut current);
    words
}

fn push_word(words: &mut Vec<String>, current: &mut String) {
    if !current.is_empty() {
        words.push(std::mem::take(current));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writing_operations_are_sending() {
        for kind in [
            "whatsapp-api.send_text",
            "x-api.create_post",
            "gmail-api.reply",
            "slack.post_message",
            "github.api_request",
            "postgres.query",
            "discord.dispatch_event",
            "telegram-bot.notifyUser",
            "notion-api.update-page",
        ] {
            assert!(is_sending_plugin_kind(kind), "{kind}");
        }
    }

    #[test]
    fn reading_operations_are_not_sending() {
        for kind in [
            "whatsapp-web.get_status",
            "google-maps-scraper.search",
            "rss-reader.fetch_feed",
            "notion-api.listPages",
            "fixture-echo.echo",
        ] {
            assert!(!is_sending_plugin_kind(kind), "{kind}");
        }
    }

    #[test]
    fn a_reading_verb_with_a_sending_word_is_sending() {
        assert!(is_sending_operation("get_and_send"));
        assert!(is_sending_operation("search_then_reply"));
        assert!(is_sending_operation("fetchAndPublish"));
        assert!(is_sending_operation("lookupThenNotify"));
    }

    #[test]
    fn unknown_or_empty_operation_names_count_as_sending() {
        assert!(is_sending_operation("frobnicate"));
        assert!(is_sending_operation(""));
        assert!(is_sending_operation("___"));
    }

    #[test]
    fn builtin_kinds_without_a_plugin_prefix_are_not_plugin_kinds() {
        assert!(!is_sending_plugin_kind("http-request"));
        assert!(!is_sending_plugin_kind("agent"));
    }
}
