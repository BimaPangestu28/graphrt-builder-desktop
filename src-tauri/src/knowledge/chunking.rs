//! How a knowledge base cuts its documents into passages ("chunks"): the
//! settings people edit under "Advanced settings", their checks, and the
//! graphrt-rag [`ChunkerConfig`] they become.
//!
//! Sizes are in tokens for people (about [`graphrt_rag::CHARS_PER_TOKEN`]
//! characters each) and in characters for graphrt. The defaults equal
//! graphrt-rag's own defaults, so knowledge bases indexed before these
//! settings existed do not need indexing again.

use graphrt_rag::{ChunkerConfig, Separator, CHARS_PER_TOKEN, DEFAULT_SEPARATORS};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Smallest and largest passage size offered, in tokens.
pub const MIN_MAX_TOKENS: u32 = 50;
pub const MAX_MAX_TOKENS: u32 = 2000;
/// Most separators one knowledge base may list.
pub const MAX_SEPARATOR_SETTINGS: usize = 12;
/// Longest custom separator or pattern, in characters.
pub const MAX_SEPARATOR_VALUE_CHARS: usize = 100;

/// Default passage size: graphrt-rag's 1000 characters.
const DEFAULT_MAX_TOKENS: u32 = 250;
/// Default overlap: graphrt-rag's 100 characters.
const DEFAULT_OVERLAP_TOKENS: u32 = 25;

/// One place where a document may be cut, in the order they are tried.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SeparatorSetting {
    /// An empty line between paragraphs.
    Paragraph,
    /// A line break.
    Line,
    /// The end of a sentence (`. `, `? `, `! `).
    Sentence,
    /// A clause break (`; `, `, `).
    Clause,
    /// A space between words.
    Word,
    /// Custom text, e.g. `---` or `Pasal`. `\n` and `\t` mean a line break and a tab.
    Text { value: String },
    /// A regular expression; the cut is made before each match (e.g. `(?m)^Pasal \d+`).
    Pattern { value: String },
}

impl SeparatorSetting {
    fn separators(&self) -> Vec<Separator> {
        let texts = |values: &[&str]| values.iter().map(|value| Separator::Text((*value).to_owned())).collect();
        match self {
            Self::Paragraph => texts(&["\n\n"]),
            Self::Line => texts(&["\n"]),
            Self::Sentence => texts(&[". ", "? ", "! "]),
            Self::Clause => texts(&["; ", ", "]),
            Self::Word => texts(&[" "]),
            Self::Text { value } => vec![Separator::Text(unescape(value))],
            Self::Pattern { value } => vec![Separator::Regex { regex: value.clone() }],
        }
    }
}

/// `\n`, `\t` and `\\` typed in a custom separator, as the characters they name.
fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Chunking of one knowledge base, as people set it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkingSettings {
    /// Largest passage, in tokens ([`MIN_MAX_TOKENS`] to [`MAX_MAX_TOKENS`]).
    pub max_tokens: u32,
    /// Tokens of the previous passage repeated at the start of the next (at most half of `max_tokens`).
    pub overlap_tokens: u32,
    /// Shorter pieces are joined with a neighbour when they fit (0 = off; at most `max_tokens`).
    pub min_tokens: u32,
    /// Where to cut, coarse to fine. Cutting inside a word is always the last resort.
    pub separators: Vec<SeparatorSetting>,
    /// Start a new passage at every heading and remember the heading.
    pub respect_headings: bool,
    /// Never let a passage span two PDF pages.
    pub split_pages: bool,
}

impl Default for ChunkingSettings {
    fn default() -> Self {
        Self {
            max_tokens: DEFAULT_MAX_TOKENS,
            overlap_tokens: DEFAULT_OVERLAP_TOKENS,
            min_tokens: 0,
            separators: vec![
                SeparatorSetting::Paragraph,
                SeparatorSetting::Line,
                SeparatorSetting::Sentence,
                SeparatorSetting::Clause,
                SeparatorSetting::Word,
            ],
            respect_headings: true,
            split_pages: false,
        }
    }
}

fn chars_for(tokens: u32) -> usize {
    usize::try_from(tokens).unwrap_or(usize::MAX).saturating_mul(CHARS_PER_TOKEN)
}

impl ChunkingSettings {
    /// The graphrt-rag chunker configuration these settings mean.
    pub fn to_chunker_config(&self) -> ChunkerConfig {
        let separators: Vec<Separator> = self.separators.iter().flat_map(SeparatorSetting::separators).collect();
        let is_default_list = separators.len() == DEFAULT_SEPARATORS.len()
            && separators
                .iter()
                .zip(DEFAULT_SEPARATORS)
                .all(|(ours, default)| *ours == Separator::Text((*default).to_owned()));
        ChunkerConfig {
            max_chars: chars_for(self.max_tokens),
            overlap: chars_for(self.overlap_tokens),
            markdown: self.respect_headings,
            parent_max_chars: None,
            // The default list is left empty so configs (and bundles) stay short.
            separators: if is_default_list { Vec::new() } else { separators },
            min_chars: chars_for(self.min_tokens),
            split_pages: self.split_pages,
        }
    }

    /// A stable text identifying how documents were cut, stored per document
    /// to tell which ones need indexing again.
    ///
    /// # Errors
    /// `Internal` when the settings cannot be serialized (never in practice).
    pub fn key(&self) -> AppResult<String> {
        serde_json::to_string(&self.to_chunker_config())
            .map_err(|error| AppError::Internal(format!("could not describe the chunking settings: {error}")))
    }

    /// # Errors
    /// `InvalidInput` with a sentence naming the first value that is out of range.
    pub fn validate(&self) -> AppResult<()> {
        if !(MIN_MAX_TOKENS..=MAX_MAX_TOKENS).contains(&self.max_tokens) {
            return Err(AppError::InvalidInput(format!(
                "the passage size must be between {MIN_MAX_TOKENS} and {MAX_MAX_TOKENS} tokens"
            )));
        }
        if self.overlap_tokens > self.max_tokens / 2 {
            return Err(AppError::InvalidInput("the overlap can be at most half of the passage size".into()));
        }
        if self.min_tokens > self.max_tokens {
            return Err(AppError::InvalidInput("the minimum size cannot be larger than the passage size".into()));
        }
        if self.separators.len() > MAX_SEPARATOR_SETTINGS {
            return Err(AppError::InvalidInput(format!("use at most {MAX_SEPARATOR_SETTINGS} separators")));
        }
        for separator in &self.separators {
            if let SeparatorSetting::Text { value } | SeparatorSetting::Pattern { value } = separator {
                if value.is_empty() {
                    return Err(AppError::InvalidInput("a custom separator cannot be empty".into()));
                }
                if value.chars().count() > MAX_SEPARATOR_VALUE_CHARS {
                    return Err(AppError::InvalidInput(format!(
                        "a custom separator can be at most {MAX_SEPARATOR_VALUE_CHARS} characters"
                    )));
                }
            }
        }
        self.to_chunker_config().validate().map_err(|error| {
            let message = error.to_string();
            let reason = message.strip_prefix("configuration error: ").unwrap_or(&message);
            AppError::InvalidInput(format!("these chunking settings cannot be used: {reason}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_equal_graphrt_defaults() {
        assert_eq!(ChunkingSettings::default().to_chunker_config(), ChunkerConfig::default());
        assert!(ChunkingSettings::default().validate().is_ok());
    }

    #[test]
    fn tokens_become_characters_and_separators_keep_their_order() {
        let settings = ChunkingSettings {
            max_tokens: 100,
            overlap_tokens: 10,
            min_tokens: 5,
            separators: vec![
                SeparatorSetting::Pattern { value: r"(?m)^Pasal \d+".into() },
                SeparatorSetting::Text { value: r"---\n".into() },
                SeparatorSetting::Paragraph,
            ],
            respect_headings: false,
            split_pages: true,
        };
        let config = settings.to_chunker_config();
        assert_eq!((config.max_chars, config.overlap, config.min_chars), (400, 40, 20));
        assert!(!config.markdown && config.split_pages);
        assert_eq!(
            config.separators,
            vec![
                Separator::Regex { regex: r"(?m)^Pasal \d+".into() },
                Separator::Text("---\n".into()),
                Separator::Text("\n\n".into()),
            ]
        );
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn out_of_range_values_are_refused_with_a_sentence() {
        let base = ChunkingSettings::default();
        let refused = |settings: ChunkingSettings| matches!(settings.validate(), Err(AppError::InvalidInput(_)));
        assert!(refused(ChunkingSettings { max_tokens: 10, ..base.clone() }));
        assert!(refused(ChunkingSettings { max_tokens: 5000, ..base.clone() }));
        assert!(refused(ChunkingSettings { overlap_tokens: 200, ..base.clone() }));
        assert!(refused(ChunkingSettings { min_tokens: 300, ..base.clone() }));
        assert!(refused(ChunkingSettings { separators: vec![SeparatorSetting::Word; 13], ..base.clone() }));
        assert!(refused(ChunkingSettings {
            separators: vec![SeparatorSetting::Text { value: String::new() }],
            ..base.clone()
        }));
        assert!(refused(ChunkingSettings {
            separators: vec![SeparatorSetting::Pattern { value: "([".into() }],
            ..base.clone()
        }));
        assert!(refused(ChunkingSettings {
            separators: vec![SeparatorSetting::Pattern { value: "a*".into() }],
            ..base
        }));
    }

    #[test]
    fn escapes_in_custom_text() {
        assert_eq!(unescape(r"a\nb\tc\\d\x"), "a\nb\tc\\d\\x");
        assert_eq!(unescape("trailing\\"), "trailing\\");
    }

    #[test]
    fn key_changes_with_the_settings_only() {
        let default_key = ChunkingSettings::default().key().unwrap_or_default();
        assert_eq!(default_key, ChunkingSettings::default().key().unwrap_or_default());
        let bigger = ChunkingSettings { max_tokens: 400, ..ChunkingSettings::default() };
        assert_ne!(default_key, bigger.key().unwrap_or_default());
    }

    #[test]
    fn serializes_for_the_frontend() {
        let json = serde_json::to_value(ChunkingSettings {
            separators: vec![SeparatorSetting::Paragraph, SeparatorSetting::Text { value: "---".into() }],
            ..ChunkingSettings::default()
        })
        .unwrap_or_default();
        assert_eq!(json["maxTokens"], 250);
        assert_eq!(json["separators"][0]["kind"], "paragraph");
        assert_eq!(json["separators"][1], serde_json::json!({ "kind": "text", "value": "---" }));
    }
}
