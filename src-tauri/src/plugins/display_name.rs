//! The name people see for a plugin ("WhatsApp Cloud API"), as opposed to its technical
//! name (`whatsapp-api`) used in node kinds, install commands, routes and logs.
//!
//! The catalog may publish a curated `display_name`; it is checked with
//! [`validate_display_name`]. Without one (older catalogs, local installs) the name is
//! humanized by [`humanize_plugin_name`]. The frontend mirrors the humanizer in
//! `src/lib/pluginDisplayName.ts` for labels that only know a plugin's name.

/// Longest curated display name accepted, in characters.
pub(crate) const MAX_DISPLAY_NAME_CHARS: usize = 60;

/// Words written in capitals: `whatsapp-api` → "… API", `s3-upload` → "S3 Upload".
const ACRONYM_WORDS: &[&str] = &[
    "ai", "api", "aws", "bmkg", "crm", "csv", "ftp", "gcp", "html", "http", "imap", "json", "llm", "ocr", "pdf", "qr",
    "rss", "s3", "sftp", "sms", "smtp", "sql", "ssh", "url", "xml",
];

/// Brand spellings that plain capitalization gets wrong (`github` → "GitHub").
const BRAND_WORDS: &[(&str, &str)] = &[
    ("bigquery", "BigQuery"),
    ("chatgpt", "ChatGPT"),
    ("github", "GitHub"),
    ("gitlab", "GitLab"),
    ("graphql", "GraphQL"),
    ("hubspot", "HubSpot"),
    ("linkedin", "LinkedIn"),
    ("mongodb", "MongoDB"),
    ("mysql", "MySQL"),
    ("openai", "OpenAI"),
    ("paypal", "PayPal"),
    ("postgresql", "PostgreSQL"),
    ("sendgrid", "SendGrid"),
    ("sqlite", "SQLite"),
    ("tiktok", "TikTok"),
    ("whatsapp", "WhatsApp"),
    ("woocommerce", "WooCommerce"),
    ("wordpress", "WordPress"),
    ("youtube", "YouTube"),
];

/// Joining words kept lower-case after the first word ("Text to Speech").
const LOWERCASE_JOINING_WORDS: &[&str] =
    &["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "via", "with"];

/// The curated display name, trimmed, or `None` when it is blank, longer than
/// [`MAX_DISPLAY_NAME_CHARS`] or contains control or invisible format characters (bidi
/// overrides, zero-width characters: see [`is_format_character`]), which could make one
/// name look like another. `"  GitHub "` gives `Some("GitHub")`; `"a\nb"` gives `None`.
pub(crate) fn validate_display_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let is_valid = !trimmed.is_empty()
        && trimmed.chars().count() <= MAX_DISPLAY_NAME_CHARS
        && !trimmed.chars().any(|character| character.is_control() || is_format_character(character));
    is_valid.then(|| trimmed.to_owned())
}

/// Ranges of the Unicode general category `Cf` (format characters), Unicode 15.1
/// (`DerivedGeneralCategory.txt`). The standard library has no category lookup.
const FORMAT_CHARACTER_RANGES: &[(u32, u32)] = &[
    (0x00AD, 0x00AD),
    (0x0600, 0x0605),
    (0x061C, 0x061C),
    (0x06DD, 0x06DD),
    (0x070F, 0x070F),
    (0x0890, 0x0891),
    (0x08E2, 0x08E2),
    (0x180E, 0x180E),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x2064),
    (0x2066, 0x206F),
    (0xFEFF, 0xFEFF),
    (0xFFF9, 0xFFFB),
    (0x110BD, 0x110BD),
    (0x110CD, 0x110CD),
    (0x13430, 0x1343F),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0001, 0xE0001),
    (0xE0020, 0xE007F),
];

/// Whether `character` is a Unicode format character (`Cf`): invisible characters such as
/// bidi overrides and isolates, zero-width spaces and joiners, soft hyphens and tags.
pub(crate) fn is_format_character(character: char) -> bool {
    let code_point = u32::from(character);
    FORMAT_CHARACTER_RANGES.iter().any(|(first, last)| (*first..=*last).contains(&code_point))
}

/// A plugin name as words people read: `currency-rates` → "Currency Rates",
/// `whatsapp-api` → "WhatsApp API", `pdf-to-text` → "PDF to Text". Acronyms are
/// capitalized, known brands keep their spelling, and words that already contain
/// capitals are kept as written.
pub(crate) fn humanize_plugin_name(name: &str) -> String {
    name.split(['-', '_', ' ', '.'])
        .filter(|word| !word.is_empty())
        .enumerate()
        .map(|(index, word)| humanize_word(index, word))
        .collect::<Vec<_>>()
        .join(" ")
}

fn humanize_word(index: usize, word: &str) -> String {
    if word.chars().any(char::is_uppercase) {
        return word.to_owned();
    }
    if ACRONYM_WORDS.contains(&word) {
        return word.to_uppercase();
    }
    if let Some((_, brand)) = BRAND_WORDS.iter().find(|(plain, _)| *plain == word) {
        return (*brand).to_owned();
    }
    if index > 0 && LOWERCASE_JOINING_WORDS.contains(&word) {
        return word.to_owned();
    }
    let mut characters = word.chars();
    characters.next().map(|first| first.to_uppercase().chain(characters).collect()).unwrap_or_default()
}

/// The first valid curated name among `curated`, else the humanized `name`.
pub(crate) fn resolve_display_name<'a>(name: &str, curated: impl IntoIterator<Item = Option<&'a str>>) -> String {
    curated.into_iter().flatten().find_map(validate_display_name).unwrap_or_else(|| humanize_plugin_name(name))
}

#[cfg(test)]
mod tests {
    use super::{humanize_plugin_name, resolve_display_name, validate_display_name, MAX_DISPLAY_NAME_CHARS};

    #[test]
    fn plugin_names_become_title_case_words() {
        assert_eq!(humanize_plugin_name("currency-rates"), "Currency Rates");
        assert_eq!(humanize_plugin_name("google-maps-scraper"), "Google Maps Scraper");
        assert_eq!(humanize_plugin_name("echo"), "Echo");
        assert_eq!(humanize_plugin_name("pdf-to-text"), "PDF to Text");
        assert_eq!(humanize_plugin_name("some__odd--name"), "Some Odd Name");
    }

    #[test]
    fn acronyms_are_capitalized_including_the_api_suffix() {
        assert_eq!(humanize_plugin_name("x-api"), "X API");
        assert_eq!(humanize_plugin_name("openai-images"), "OpenAI Images");
        for (name, expected) in [
            ("ai-summary", "AI Summary"),
            ("crm-sync", "CRM Sync"),
            ("csv-tools", "CSV Tools"),
            ("qr-code", "QR Code"),
            ("sql-query", "SQL Query"),
            ("sftp", "SFTP"),
            ("rss-reader", "RSS Reader"),
            ("ocr", "OCR"),
            ("s3-upload", "S3 Upload"),
            ("bmkg", "BMKG"),
        ] {
            assert_eq!(humanize_plugin_name(name), expected, "{name}");
        }
    }

    #[test]
    fn known_brands_keep_their_spelling() {
        assert_eq!(humanize_plugin_name("github"), "GitHub");
        assert_eq!(humanize_plugin_name("whatsapp-api"), "WhatsApp API");
        assert_eq!(humanize_plugin_name("whatsapp-web"), "WhatsApp Web");
        assert_eq!(humanize_plugin_name("youtube-transcripts"), "YouTube Transcripts");
    }

    #[test]
    fn blank_names_stay_blank() {
        assert_eq!(humanize_plugin_name(""), "");
        assert_eq!(humanize_plugin_name("--"), "");
    }

    #[test]
    fn curated_names_are_trimmed_and_checked() {
        assert_eq!(validate_display_name("  WhatsApp Cloud API "), Some("WhatsApp Cloud API".to_owned()));
        assert_eq!(validate_display_name("   "), None);
        assert_eq!(validate_display_name("Line\nbreak"), None);
        assert_eq!(validate_display_name("Bell\u{7}"), None);
        assert_eq!(validate_display_name(&"a".repeat(MAX_DISPLAY_NAME_CHARS)).map(|name| name.len()), Some(60));
        assert_eq!(validate_display_name(&"a".repeat(MAX_DISPLAY_NAME_CHARS + 1)), None);
        assert_eq!(
            validate_display_name(&"é".repeat(MAX_DISPLAY_NAME_CHARS)).map(|name| name.chars().count()),
            Some(60)
        );
    }

    #[test]
    fn names_with_invisible_format_characters_are_refused() {
        for spoofed in [
            "WhatsApp\u{202E}IPA",    // right-to-left override
            "Whats\u{200B}App",       // zero-width space
            "Whats\u{200D}App",       // zero-width joiner
            "\u{2066}GitHub\u{2069}", // bidi isolates
            "Git\u{00AD}Hub",         // soft hyphen
            "\u{FEFF}GitHub",         // byte order mark
            "Git\u{E0041}Hub",        // tag character
        ] {
            assert_eq!(validate_display_name(spoofed), None, "{spoofed:?}");
        }
        assert_eq!(validate_display_name("Café Tools"), Some("Café Tools".to_owned()));
        assert_eq!(validate_display_name("日本語ツール"), Some("日本語ツール".to_owned()));
    }

    #[test]
    fn the_first_valid_curated_name_wins_over_the_humanized_name() {
        assert_eq!(resolve_display_name("github", [None, Some("GitHub Tools")]), "GitHub Tools");
        assert_eq!(resolve_display_name("github", [Some(" "), Some("Hub")]), "Hub");
        assert_eq!(resolve_display_name("currency-rates", [None, None]), "Currency Rates");
    }
}
