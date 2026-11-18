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

#[cfg(test)]
mod tests {
    use super::*;

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
