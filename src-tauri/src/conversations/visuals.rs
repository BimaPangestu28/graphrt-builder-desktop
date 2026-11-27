//! UI blocks (cards, charts, tables, KPI tiles, diagrams) in a chatbot's replies.
//!
//! A bot turn's blocks are validated with `graphrt_ui::validate` and stored on the reply as
//! `metadata.visuals`. What the customer gets depends on the channel
//! ([`ChannelCapabilities`]):
//! - a channel that draws blocks (the in-app test channel) gets the reply text as it is;
//!   the app renders the blocks from the metadata;
//! - any other channel gets the reply text followed by each block as text
//!   (`graphrt_ui::fallback`): a card with numbered choices, a table as compact lines, a
//!   chart as a short summary, or as a PNG image when the channel sends images.
//!
//! The numbered choices of a reply's cards are stored as `metadata.choices`. When the
//! customer's next message is one of the numbers (or a button's title), it is read as that
//! button: see [`match_reply`] and [`CardAnswer`].

use graphrt_ui::fallback::{match_choice, to_text, Choice, Markup, TextOptions};
use graphrt_ui::png::{chart_png, PngOptions};
use graphrt_ui::{UiBlock, UiKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::desktop::ui_language::UiLanguage;
use crate::error::{AppError, AppResult};

/// Most blocks one reply shows.
pub const MAX_REPLY_VISUALS: usize = 6;
/// Metadata key of a reply's validated blocks.
pub const VISUALS_KEY: &str = "visuals";
/// Metadata key of a reply's numbered choices.
pub const CHOICES_KEY: &str = "choices";
/// Metadata key set when a reply had no text of its own and `text` is the blocks' text form.
pub const TEXT_IS_FALLBACK_KEY: &str = "textIsFallback";
/// Metadata key of the card button a customer message stands for.
pub const CARD_ACTION_KEY: &str = "cardAction";
/// Longest title of a card answer, in characters.
const MAX_ANSWER_TITLE_CHARS: usize = 300;
/// Largest `values` of a card answer, in bytes of JSON.
const MAX_ANSWER_VALUES_BYTES: usize = 16 * 1024;
/// Most `name: value` lines of a card answer told to the bot.
const MAX_ANSWER_LINES: usize = 20;

/// What a channel can show besides text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ChannelCapabilities {
    /// The channel's client draws UI blocks itself (the app's own test channel).
    pub blocks: bool,
    /// The channel sends images (WhatsApp, Telegram): charts go out as PNG.
    pub images: bool,
    /// How the channel writes bold text.
    pub markup: Markup,
}

impl ChannelCapabilities {
    /// A channel whose client renders blocks: nothing is converted.
    pub const RICH: Self = Self { blocks: true, images: true, markup: Markup::Plain };
}

/// An image sent along with a reply.
#[derive(Clone, PartialEq, Eq)]
pub struct OutboundImage {
    pub png: Vec<u8>,
    /// The chart's title, when it has one.
    pub caption: Option<String>,
}

impl std::fmt::Debug for OutboundImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OutboundImage").field("png_bytes", &self.png.len()).field("caption", &self.caption).finish()
    }
}

/// A reply as it is stored and as it is sent.
#[derive(Debug, Clone, PartialEq)]
pub struct ComposedReply {
    /// The message text stored (never empty when the reply had text or blocks).
    pub stored_text: String,
    /// The text sent on the channel.
    pub outbound_text: String,
    pub images: Vec<OutboundImage>,
    /// `visuals`, `choices` and `textIsFallback` for the message metadata.
    pub metadata: Map<String, Json>,
}

/// The card button a customer message stands for. Keep `src/api/conversationTypes.ts`
/// (`CardAnswer`) in sync.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardAnswer {
    /// The button's answer key (`Action.Execute` verb, else the action id); `None` for a
    /// card without a submit button.
    #[serde(default)]
    pub action: Option<String>,
    /// The button's title: what the customer chose, in words.
    pub title: String,
    /// The card's input values and the button's `data`.
    #[serde(default)]
    pub values: Map<String, Json>,
}

impl CardAnswer {
    /// # Errors
    /// `InvalidInput` for an empty or overlong title, or values over 16 KiB.
    pub fn validated(mut self) -> AppResult<Self> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > MAX_ANSWER_TITLE_CHARS {
            return Err(AppError::InvalidInput("a card answer needs a short title".into()));
        }
        let size = serde_json::to_vec(&self.values).map(|bytes| bytes.len()).unwrap_or(usize::MAX);
        if size > MAX_ANSWER_VALUES_BYTES {
            return Err(AppError::InvalidInput("the card's values are too large".into()));
        }
        Ok(self)
    }

    /// The answer as the bot reads it: the title, then one `name: value` line per filled input.
    pub fn as_message_text(&self) -> String {
        let mut lines = vec![self.title.clone()];
        for (name, value) in self.values.iter().take(MAX_ANSWER_LINES) {
            let shown = match value {
                Json::String(text) if !text.trim().is_empty() => text.trim().to_owned(),
                Json::Number(number) => number.to_string(),
                Json::Bool(flag) => if *flag { "yes" } else { "no" }.to_owned(),
                _ => continue,
            };
            lines.push(format!("{name}: {shown}"));
        }
        lines.join("\n")
    }

    /// The bot run's `sys.card_action` and `sys.card_values` (JSON text), for flows that branch on them.
    pub fn sys_values(&self) -> Vec<(String, String)> {
        vec![
            ("card_action".to_owned(), self.action.clone().unwrap_or_default()),
            ("card_values".to_owned(), Json::Object(self.values.clone()).to_string()),
        ]
    }
}

/// The valid blocks among `candidates`, in order, without repeats, at most
/// [`MAX_REPLY_VISUALS`]. Invalid blocks are logged and dropped: a customer is never shown
/// a broken card.
pub fn validated_blocks(candidates: &[Json], conversation_id: &str) -> Vec<UiBlock> {
    let mut blocks: Vec<UiBlock> = Vec::new();
    for candidate in candidates {
        if blocks.len() >= MAX_REPLY_VISUALS {
            log::info!(
                "conversation {conversation_id}: a reply shows at most {MAX_REPLY_VISUALS} blocks, dropped the rest"
            );
            break;
        }
        if blocks.iter().any(|block| block.as_json() == candidate) {
            continue;
        }
        match graphrt_ui::validate(candidate) {
            Ok(block) => blocks.push(block),
            Err(error) => log::warn!("conversation {conversation_id}: dropped a block the bot returned: {error}"),
        }
    }
    blocks
}

/// The stored blocks of a message, validated again (the rules may be stricter than when
/// the message was stored).
pub fn stored_blocks(metadata: &Json) -> Vec<UiBlock> {
    metadata
        .get(VISUALS_KEY)
        .and_then(Json::as_array)
        .map(|blocks| blocks.iter().filter_map(|block| graphrt_ui::validate(block).ok()).collect())
        .unwrap_or_default()
}

fn text_options(language: UiLanguage, markup: Markup) -> TextOptions {
    let options = match markup {
        Markup::WhatsApp => TextOptions::whatsapp(),
        Markup::Markdown => TextOptions::markdown(),
        _ => TextOptions::default(),
    };
    match language {
        UiLanguage::En => options,
        UiLanguage::Id => options.with_separators('.', ',').with_choice_prompt("Balas dengan angka:"),
    }
}

fn png_options(language: UiLanguage) -> PngOptions {
    match language {
        UiLanguage::En => PngOptions::default(),
        UiLanguage::Id => PngOptions { thousands: '.', decimal: ',', ..PngOptions::default() },
    }
}

/// Every block as text in `markup`, with the cards' choices numbered through the whole reply.
fn blocks_as_text(blocks: &[UiBlock], language: UiLanguage, markup: Markup) -> (Vec<String>, Vec<Choice>) {
    let mut texts = Vec::with_capacity(blocks.len());
    let mut choices: Vec<Choice> = Vec::new();
    for block in blocks {
        let options = text_options(language, markup).with_first_choice(choices.len() + 1);
        let fallback = to_text(block, &options);
        texts.push(fallback.text);
        choices.extend(fallback.choices);
    }
    (texts, choices)
}

fn choice_to_json(choice: &Choice) -> Json {
    json!({"number": choice.number, "title": choice.title, "action": choice.action, "values": choice.values})
}

fn choice_from_json(value: &Json) -> Option<Choice> {
    Some(Choice {
        number: usize::try_from(value.get("number")?.as_u64()?).ok()?,
        title: value.get("title")?.as_str()?.to_owned(),
        action: value.get("action").and_then(Json::as_str).map(str::to_owned),
        values: value.get("values").and_then(Json::as_object).cloned().unwrap_or_default(),
    })
}

/// Builds what is stored and what is sent for a reply of `text` and `blocks` on a channel
/// with `capabilities`.
pub fn compose_reply(
    text: &str,
    blocks: &[UiBlock],
    capabilities: ChannelCapabilities,
    language: UiLanguage,
) -> ComposedReply {
    let text = text.trim();
    let mut metadata = Map::new();
    if blocks.is_empty() {
        return ComposedReply {
            stored_text: text.to_owned(),
            outbound_text: text.to_owned(),
            images: Vec::new(),
            metadata,
        };
    }
    let (plain_texts, choices) = blocks_as_text(blocks, language, Markup::Plain);
    metadata.insert(VISUALS_KEY.into(), Json::Array(blocks.iter().map(|block| block.as_json().clone()).collect()));
    if !choices.is_empty() {
        metadata.insert(CHOICES_KEY.into(), Json::Array(choices.iter().map(choice_to_json).collect()));
    }
    let stored_text = if text.is_empty() {
        metadata.insert(TEXT_IS_FALLBACK_KEY.into(), Json::Bool(true));
        plain_texts.join("\n\n")
    } else {
        text.to_owned()
    };
    if capabilities.blocks {
        return ComposedReply { outbound_text: stored_text.clone(), stored_text, images: Vec::new(), metadata };
    }

    let (channel_texts, _) = blocks_as_text(blocks, language, capabilities.markup);
    let mut parts: Vec<String> = Vec::new();
    if !text.is_empty() {
        parts.push(text.to_owned());
    }
    let mut images = Vec::new();
    for (block, block_text) in blocks.iter().zip(channel_texts) {
        if capabilities.images && block.kind() == UiKind::Chart {
            match chart_png(block, &png_options(language)) {
                Ok(png) => {
                    images.push(OutboundImage { png, caption: block.title().map(str::to_owned) });
                    continue;
                }
                // Labels in a script the built-in font lacks: the text form says the same.
                Err(error) => log::info!("sending a chart as text instead of an image: {error}"),
            }
        }
        parts.push(block_text);
    }
    ComposedReply { stored_text, outbound_text: parts.join("\n\n"), images, metadata }
}

/// The card button `reply` picks among the numbered choices of the bot message with
/// `bot_metadata`: its number or its title. `None` for an ordinary message.
pub fn match_reply(bot_metadata: &Json, reply: &str) -> Option<CardAnswer> {
    let choices: Vec<Choice> = bot_metadata.get(CHOICES_KEY)?.as_array()?.iter().filter_map(choice_from_json).collect();
    let choice = match_choice(&choices, reply)?;
    Some(CardAnswer { action: choice.action.clone(), title: choice.title.clone(), values: choice.values.clone() })
}

/// Whether the message with `metadata` shows a card.
pub fn has_card(metadata: &Json) -> bool {
    stored_blocks(metadata).iter().any(|block| block.kind() == UiKind::AdaptiveCard)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(value: Json) -> UiBlock {
        graphrt_ui::validate(&value).unwrap()
    }

    fn card(question: &str, actions: &[(&str, &str)]) -> Json {
        let actions: Vec<Json> =
            actions.iter().map(|(id, title)| json!({"type": "Action.Submit", "id": id, "title": title})).collect();
        json!({"$ui": "adaptive_card", "version": 1,
               "card": {"type": "AdaptiveCard", "version": "1.5",
                        "body": [{"type": "TextBlock", "text": question}], "actions": actions}})
    }

    fn chart() -> Json {
        json!({"$ui": "chart", "version": 1, "type": "bar", "title": "Sales",
               "x": {"values": ["Jan", "Feb"]}, "series": [{"name": "2026", "values": [1200, 1500]}]})
    }

    const TEXT_ONLY: ChannelCapabilities =
        ChannelCapabilities { blocks: false, images: false, markup: Markup::WhatsApp };
    const WITH_IMAGES: ChannelCapabilities =
        ChannelCapabilities { blocks: false, images: true, markup: Markup::WhatsApp };

    #[test]
    fn a_reply_without_blocks_is_only_trimmed() {
        let reply = compose_reply("  Halo kak  ", &[], TEXT_ONLY, UiLanguage::Id);
        assert_eq!(reply.stored_text, "Halo kak");
        assert_eq!(reply.outbound_text, "Halo kak");
        assert!(reply.metadata.is_empty() && reply.images.is_empty());
    }

    #[test]
    fn a_rich_channel_gets_the_text_and_the_blocks_in_metadata() {
        let blocks = [block(card("Deliver **today**?", &[("yes", "Yes"), ("no", "No")])), block(chart())];
        let reply = compose_reply("Here you go", &blocks, ChannelCapabilities::RICH, UiLanguage::En);
        assert_eq!(reply.outbound_text, "Here you go");
        assert_eq!(reply.stored_text, "Here you go");
        assert_eq!(reply.metadata[VISUALS_KEY].as_array().unwrap().len(), 2);
        assert_eq!(reply.metadata[CHOICES_KEY][1], json!({"number": 2, "title": "No", "action": "no", "values": {}}));
        assert!(!reply.metadata.contains_key(TEXT_IS_FALLBACK_KEY));
        assert!(reply.images.is_empty());
    }

    #[test]
    fn a_text_channel_gets_the_blocks_as_text_with_numbered_choices() {
        let blocks = [block(card("Deliver **today**?", &[("yes", "Yes"), ("no", "No")])), block(chart())];
        let reply = compose_reply("Here you go", &blocks, TEXT_ONLY, UiLanguage::Id);
        assert_eq!(
            reply.outbound_text,
            "Here you go\n\nDeliver *today*?\n\nBalas dengan angka:\n1. Yes\n2. No\n\n*Sales*\nJan: 1.200\nFeb: 1.500"
        );
        assert_eq!(reply.stored_text, "Here you go");
        assert!(reply.images.is_empty());
    }

    #[test]
    fn a_media_channel_gets_charts_as_images() {
        let blocks = [block(chart()), block(card("OK?", &[("ok", "OK")]))];
        let reply = compose_reply("", &blocks, WITH_IMAGES, UiLanguage::En);
        assert_eq!(reply.images.len(), 1);
        assert!(reply.images[0].png.starts_with(b"\x89PNG"));
        assert_eq!(reply.images[0].caption.as_deref(), Some("Sales"));
        assert_eq!(reply.outbound_text, "OK?\n\nReply with a number:\n1. OK");
        // Stored without WhatsApp markers, and flagged so the app shows the blocks instead.
        assert_eq!(reply.stored_text, "Sales\nJan: 1,200\nFeb: 1,500\n\nOK?\n\nReply with a number:\n1. OK");
        assert_eq!(reply.metadata[TEXT_IS_FALLBACK_KEY], json!(true));
    }

    #[test]
    fn a_chart_the_font_cannot_draw_goes_out_as_text() {
        let chart = json!({"$ui": "chart", "version": 1, "type": "bar", "title": "売上",
                           "x": {"values": ["一月"]}, "series": [{"name": "S", "values": [5]}]});
        let reply = compose_reply("", &[block(chart)], WITH_IMAGES, UiLanguage::En);
        assert!(reply.images.is_empty());
        assert_eq!(reply.outbound_text, "*売上*\n一月: 5");
    }

    #[test]
    fn choices_of_several_cards_are_numbered_through() {
        let blocks = [block(card("First?", &[("a", "A"), ("b", "B")])), block(card("Second?", &[("c", "C")]))];
        let reply = compose_reply("", &blocks, TEXT_ONLY, UiLanguage::En);
        assert!(reply.outbound_text.ends_with("Second?\n\nReply with a number:\n3. C"), "{}", reply.outbound_text);
        let metadata = Json::Object(reply.metadata);
        assert_eq!(match_reply(&metadata, "3").unwrap().action.as_deref(), Some("c"));
        assert_eq!(match_reply(&metadata, " b ").unwrap().action.as_deref(), Some("b"));
        assert_eq!(match_reply(&metadata, "4"), None);
        assert_eq!(match_reply(&metadata, "what is the price?"), None);
        assert_eq!(match_reply(&json!({}), "1"), None);
    }

    #[test]
    fn invalid_and_repeated_blocks_are_dropped_and_the_count_is_capped() {
        let bad = json!({"$ui": "chart", "version": 1, "type": "bar", "x": {"values": ["a"]}, "series": []});
        let script = json!({"$ui": "diagram", "version": 1, "syntax": "mermaid", "source": "flowchart TD\n A[<img src=x>] --> B"});
        let kept = validated_blocks(&[chart(), bad, chart(), script, card("Q", &[])], "c1");
        let kinds: Vec<UiKind> = kept.iter().map(UiBlock::kind).collect();
        assert_eq!(kinds, [UiKind::Chart, UiKind::AdaptiveCard]);
        let many: Vec<Json> = (0..10).map(|i| card(&format!("Q{i}"), &[])).collect();
        assert_eq!(validated_blocks(&many, "c1").len(), MAX_REPLY_VISUALS);
    }

    #[test]
    fn a_card_answer_is_checked_and_told_to_the_bot_in_words() {
        let answer = CardAnswer {
            action: Some("approve".into()),
            title: "  Approve refund ".into(),
            values: json!({"amount": 250000, "note": "", "restock": false, "reason": "damaged", "nested": {"x": 1}})
                .as_object()
                .cloned()
                .unwrap(),
        }
        .validated()
        .unwrap();
        assert_eq!(answer.as_message_text(), "Approve refund\namount: 250000\nrestock: no\nreason: damaged");
        assert_eq!(answer.sys_values()[0], ("card_action".to_owned(), "approve".to_owned()));
        assert!(answer.sys_values()[1].1.contains("\"amount\":250000"));
        let blank = CardAnswer { action: None, title: " ".into(), values: Map::new() };
        assert!(matches!(blank.validated(), Err(AppError::InvalidInput(_))));
        let huge = CardAnswer {
            action: None,
            title: "OK".into(),
            values: json!({"note": "x".repeat(20_000)}).as_object().cloned().unwrap(),
        };
        assert!(matches!(huge.validated(), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn stored_blocks_are_validated_again() {
        let metadata = json!({"visuals": [chart(), {"$ui": "chart", "version": 1}, "text"]});
        assert_eq!(stored_blocks(&metadata).len(), 1);
        assert!(!has_card(&metadata));
        assert!(has_card(&json!({"visuals": [card("Q", &[])]})));
        assert!(stored_blocks(&json!({})).is_empty());
    }
}
