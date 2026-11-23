//! Pulls the workflow document and the agent name out of a model reply.
//!
//! Models do not always follow the reply format: they add prose, use several
//! fences, forget the fence, or get cut off before the closing fence. These
//! functions accept all of that.

use super::prompt::AGENT_NAME_PREFIX;

/// Longest agent name kept; longer names are cut at a word boundary.
const MAX_NAME_CHARS: usize = 60;

/// Words kept when deriving a name from the description.
const DESCRIPTION_NAME_WORDS: usize = 6;

/// A fenced code block: its info string (e.g. `yaml`) and body.
struct FencedBlock {
    language: String,
    body: String,
}

/// The YAML document in a reply.
///
/// Prefers ```yaml / ```yml blocks (else any fenced block), and among those the
/// one that looks like a whole workflow (`graph:`), else the longest. Without a
/// fence, the text from the first `version:` line on, else the whole text.
pub(super) fn workflow_yaml(reply: &str) -> String {
    let blocks = fenced_blocks(reply);
    let yaml_blocks: Vec<&FencedBlock> =
        blocks.iter().filter(|block| matches!(block.language.as_str(), "yaml" | "yml")).collect();
    let candidates = if yaml_blocks.is_empty() { blocks.iter().collect() } else { yaml_blocks };
    let chosen = candidates
        .iter()
        .copied()
        .filter(|block| looks_like_workflow(&block.body))
        .max_by_key(|block| block.body.len())
        .or_else(|| candidates.iter().copied().max_by_key(|block| block.body.len()));
    match chosen {
        Some(block) => with_trailing_newline(block.body.trim()),
        None => with_trailing_newline(unfenced_document(reply)),
    }
}

fn looks_like_workflow(text: &str) -> bool {
    text.lines().any(|line| line.trim_end() == "graph:" || line.starts_with("graph:"))
}

/// Every fenced block; an unterminated last fence runs to the end of the text.
fn fenced_blocks(text: &str) -> Vec<FencedBlock> {
    let mut blocks = Vec::new();
    let mut current: Option<FencedBlock> = None;
    for line in text.lines() {
        if let Some(info) = line.trim().strip_prefix("```") {
            match current.take() {
                None => {
                    current = Some(FencedBlock { language: info.trim().to_ascii_lowercase(), body: String::new() });
                    continue;
                }
                Some(block) if info.trim().is_empty() => {
                    blocks.push(block);
                    continue;
                }
                // "```lang" inside an open block is content, not a new fence.
                Some(block) => current = Some(block),
            }
        }
        if let Some(block) = current.as_mut() {
            block.body.push_str(line);
            block.body.push('\n');
        }
    }
    blocks.extend(current);
    blocks
}

/// Reply without fences: skip any prose before the `version:` line.
fn unfenced_document(reply: &str) -> &str {
    let mut offset = 0;
    for line in reply.split_inclusive('\n') {
        if line.starts_with("version:") {
            return reply[offset..].trim();
        }
        offset += line.len();
    }
    reply.trim()
}

fn with_trailing_newline(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    format!("{text}\n")
}

/// The `Agent name:` line outside the YAML (markdown emphasis and quotes removed),
/// or a `# name:` comment.
pub(super) fn agent_name(reply: &str) -> Option<String> {
    reply.lines().find_map(|line| {
        let line = line.trim().trim_matches(|character| character == '*' || character == '_').trim();
        let value =
            strip_prefix_ignore_case(line, AGENT_NAME_PREFIX).or_else(|| strip_prefix_ignore_case(line, "# name:"))?;
        clean_name(value)
    })
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

/// The document's top-level `name:` (kebab-case) as words: `cafe-offers` → `Cafe offers`.
pub(super) fn document_name(flow_yaml: &str) -> Option<String> {
    let value = flow_yaml.lines().find_map(|line| line.strip_prefix("name:"))?;
    let value = value.split(" #").next().unwrap_or(value);
    let words = value.trim().trim_matches(|character| character == '"' || character == '\'').replace(['-', '_'], " ");
    clean_name(&words).map(|name| capitalize_first(&name))
}

/// Small words kept lower-case inside a title ("Leads to WhatsApp", "Find Cafes in Bandar Lampung").
const LOWERCASE_TITLE_WORDS: &[&str] =
    &["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "via", "with"];

/// Makes a generated name read like a title a person wrote:
/// `find_business_promotions` → "Find Business Promotions", "Morning email digest" →
/// "Morning Email Digest". Small joining words stay lower-case after the first word, and
/// words that already have capitals ("WhatsApp", "API") are kept as written.
pub(super) fn humanize_name(raw: &str) -> String {
    let spaced = raw.replace(['_', '-'], " ");
    spaced
        .split_whitespace()
        .enumerate()
        .map(|(index, word)| {
            let is_lowercase_word = !word.chars().any(char::is_uppercase);
            if index > 0 && is_lowercase_word && LOWERCASE_TITLE_WORDS.contains(&word) {
                word.to_owned()
            } else {
                capitalize_first(word)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Fallback name: the first words of the description's first sentence.
pub(super) fn name_from_description(description: &str) -> String {
    let first_sentence = description.split(['.', '\n', ',', ';', ':']).next().unwrap_or(description);
    let words: Vec<&str> = first_sentence.split_whitespace().take(DESCRIPTION_NAME_WORDS).collect();
    clean_name(&words.join(" ")).map(|name| capitalize_first(&name)).unwrap_or_else(|| "New agent".to_owned())
}

/// Trims quotes and punctuation, collapses spaces and caps the length; `None` if empty.
fn clean_name(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|character: char| matches!(character, '"' | '\'' | '`' | '*' | '_') || character.is_whitespace());
    let trimmed = trimmed.trim_end_matches(['.', '!', ',', ';', ':']);
    let mut name = String::new();
    for word in trimmed.split_whitespace() {
        let separator_length = usize::from(!name.is_empty());
        if name.chars().count() + separator_length + word.chars().count() > MAX_NAME_CHARS {
            break;
        }
        if !name.is_empty() {
            name.push(' ');
        }
        name.push_str(word);
    }
    (!name.is_empty()).then_some(name)
}

fn capitalize_first(text: &str) -> String {
    let mut characters = text.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

/// Same document apart from trailing whitespace and blank lines.
pub(super) fn same_document(left: &str, right: &str) -> bool {
    let significant_lines =
        |text: &str| text.lines().map(str::trim_end).filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n");
    significant_lines(left) == significant_lines(right)
}

/// Hosts the reply proposes with "Trust <host> for lookups" (normalized, in order,
/// without duplicates). Only a proposal: the UI shows each as a button, and only the
/// user's click trusts a host.
///
/// @example `proposed_trusted_hosts("Done. Trust api.open-meteo.com for lookups.") == ["api.open-meteo.com"]`
pub(crate) fn proposed_trusted_hosts(text: &str) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut hosts: Vec<String> = Vec::new();
    for window in words.windows(4) {
        let closes = window[3].trim_end_matches(['.', ',', ';', ':', '!', ')']);
        let is_proposal = window[0].trim_start_matches(['(', '-', '*']).eq_ignore_ascii_case("trust")
            && window[2].eq_ignore_ascii_case("for")
            && closes.eq_ignore_ascii_case("lookups");
        if !is_proposal {
            continue;
        }
        let candidate = window[1].trim_matches(['`', '"', '\'']);
        if let Ok(host) = crate::flow::trusted_hosts::normalize_trusted_host(candidate) {
            if !hosts.contains(&host) {
                hosts.push(host);
            }
        }
    }
    hosts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_proposals_are_read_from_the_reply() {
        let reply = "I added a weather lookup. Trust `API.open-meteo.com` for lookups. Also trust *.maps.org for \
                     lookups, and trust api.open-meteo.com for lookups again.";
        assert_eq!(proposed_trusted_hosts(reply), ["api.open-meteo.com", "*.maps.org"]);
        assert!(proposed_trusted_hosts("Trust https://evil.org/x for lookups").is_empty());
        assert!(proposed_trusted_hosts("I trust you for lookups").is_empty());
        assert!(proposed_trusted_hosts("Nothing to trust here").is_empty());
    }

    const DOCUMENT: &str = "version: \"1\"\nname: cafe-offers\ngraph:\n  nodes: []\n";

    #[test]
    fn fenced_yaml_block_is_extracted() {
        let reply = format!("Agent name: Cafe offers\n```yaml\n{DOCUMENT}```\nHope this helps!");
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn unfenced_reply_is_used_whole() {
        assert_eq!(workflow_yaml(DOCUMENT), DOCUMENT);
        assert_eq!(workflow_yaml(&format!("\n\n{DOCUMENT}\n\n")), DOCUMENT);
    }

    #[test]
    fn unfenced_reply_skips_prose_before_version() {
        let reply = format!("Agent name: Cafe offers\nHere is the document:\n{DOCUMENT}");
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn multiple_fences_prefer_the_full_workflow() {
        let reply = format!(
            "Inputs look like:\n```yaml\n- {{ variable: area }}\n```\nFull document:\n```yaml\n{DOCUMENT}```\n\
             Run it with:\n```bash\ngraphrt run flow.yaml --input area=Lampung --verbose --more-flags\n```\n"
        );
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn yaml_tagged_fence_wins_over_untagged() {
        let reply = format!(
            "```\nsome notes that are quite long, longer than the document itself, really\n```\n```yml\n{DOCUMENT}```"
        );
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn untagged_fence_is_used_when_no_yaml_tag() {
        let reply = format!("```\n{DOCUMENT}```");
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn unterminated_fence_runs_to_end() {
        let reply = format!("Agent name: Cafe offers\n```yaml\n{DOCUMENT}");
        assert_eq!(workflow_yaml(&reply), DOCUMENT);
    }

    #[test]
    fn empty_reply_gives_empty_document() {
        assert_eq!(workflow_yaml("   \n"), "");
    }

    #[test]
    fn agent_name_line_variants() {
        assert_eq!(agent_name("Agent name: Cafe offers\n```yaml\n```").as_deref(), Some("Cafe offers"));
        assert_eq!(agent_name("**Agent name:** \"Cafe offers.\"").as_deref(), Some("Cafe offers"));
        assert_eq!(agent_name("agent NAME:   Lead finder  ").as_deref(), Some("Lead finder"));
        assert_eq!(agent_name("```yaml\n# name: Inbox helper\nversion: \"1\"\n```").as_deref(), Some("Inbox helper"));
        assert_eq!(agent_name("Agent name:   \n"), None);
        assert_eq!(agent_name(DOCUMENT), None);
    }

    #[test]
    fn long_agent_name_is_cut_at_a_word() {
        let reply = format!("Agent name: {}", "word ".repeat(30));
        let name = agent_name(&reply).unwrap();
        assert!(name.chars().count() <= MAX_NAME_CHARS, "{name}");
        assert!(name.ends_with("word"));
    }

    #[test]
    fn document_name_is_humanized() {
        assert_eq!(document_name(DOCUMENT).as_deref(), Some("Cafe offers"));
        assert_eq!(document_name("name: \"lead_finder\" # comment\n").as_deref(), Some("Lead finder"));
        assert_eq!(document_name("graph:\n  name: nested\n"), None);
    }

    #[test]
    fn name_from_description_takes_first_words() {
        let description = "find cafes in Bandar Lampung on Google Maps, get their name and phone number";
        assert_eq!(name_from_description(description), "Find cafes in Bandar Lampung on");
        assert_eq!(name_from_description("Summarize my inbox."), "Summarize my inbox");
        assert_eq!(name_from_description("  ...  "), "New agent");
    }

    #[test]
    fn same_document_ignores_trailing_whitespace_and_blank_lines() {
        assert!(same_document("a: 1\n\nb: 2\n", "a: 1   \nb: 2"));
        assert!(!same_document("a: 1\nb: 2\n", "a: 1\nb: 3\n"));
    }
}

#[cfg(test)]
mod humanize_tests {
    use super::humanize_name;

    #[test]
    fn identifier_style_names_become_titles() {
        assert_eq!(humanize_name("find_business_promotions"), "Find Business Promotions");
        assert_eq!(humanize_name("cafe-offers-in-bandar-lampung"), "Cafe Offers in Bandar Lampung");
        assert_eq!(humanize_name("leads to sales recap"), "Leads to Sales Recap");
    }

    #[test]
    fn sentence_case_names_become_title_case_and_keep_brand_capitals() {
        assert_eq!(humanize_name("Morning email digest"), "Morning Email Digest");
        assert_eq!(humanize_name("WhatsApp_cafe_offers"), "WhatsApp Cafe Offers");
        assert_eq!(humanize_name("Send leads to CRM via API"), "Send Leads to CRM via API");
        assert_eq!(humanize_name("Find Business Promotions"), "Find Business Promotions");
    }

    #[test]
    fn blank_names_stay_blank() {
        assert_eq!(humanize_name("  "), "");
    }
}
