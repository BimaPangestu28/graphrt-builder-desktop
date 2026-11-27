//! The fallback for a setting no plugin or catalog entry declares (see `setting_spec.rs`):
//! what its name says about it. Older plugins only have the flat `permissions.env` list, so
//! name endings stand in for "has a default" and for the kind of value.

use super::setting_spec::SettingKind;

/// Endings of settings that hold a number the plugins default themselves (limits, sizes,
/// time-outs, intervals).
const NUMBER_SUFFIXES: &[&str] = &[
    "_MINUTES",
    "_SECONDS",
    "_HOURS",
    "_MS",
    "_LIMIT",
    "_INTERVAL",
    "_BYTES",
    "_MB",
    "_PAGES",
    "_PIXELS",
    "_CELLS",
    "_ROWS",
    "_COLUMNS",
    "_ENTRIES",
    "_THREADS",
];

/// Endings of other tuning settings the plugins default themselves (API version, language,
/// extra fonts, the path of a helper program).
const TEXT_SUFFIXES: &[&str] = &["_VERSION", "_LANGUAGE", "_FONTS", "_BINARY"];

/// Guard rails for AI tool calls (`<PLUGIN>_TOOL_ALLOW_SEND`, `..._TOOL_MAX_AMOUNT`): off or
/// strict by default, so a plugin always works without them.
const TOOL_GUARD_MARKER: &str = "_TOOL_";

/// What a setting's name says about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NameGuess {
    /// The plugin works without a value (it has a default).
    pub optional: bool,
    pub kind: SettingKind,
    /// A list of folders (`..._DIRS`).
    pub multiple: bool,
}

/// The guess for `variable`. Anything the rules do not know is a required secret: the safe
/// reading of a name such as `X_ACCESS_TOKEN` or `META_PAGE_ID` (asked for, never shown again).
pub(crate) fn guess_from_name(variable: &str) -> NameGuess {
    let optional = |kind: SettingKind, multiple: bool| NameGuess { optional: true, kind, multiple };
    if variable.ends_with("_DIRS") {
        return optional(SettingKind::Folder, true);
    }
    // Includes `..._PROFILE_DIR`, which gets a default folder from the app (see `host.rs`).
    if variable.ends_with("_DIR") {
        return optional(SettingKind::Folder, false);
    }
    if NUMBER_SUFFIXES.iter().any(|suffix| variable.ends_with(suffix)) {
        return optional(SettingKind::Number, false);
    }
    if TEXT_SUFFIXES.iter().any(|suffix| variable.ends_with(suffix)) || variable.contains(TOOL_GUARD_MARKER) {
        return optional(SettingKind::Text, false);
    }
    NameGuess { optional: false, kind: SettingKind::Secret, multiple: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tuning_settings_are_optional_and_credentials_are_not() {
        for optional in [
            "WHATSAPP_GRAPH_VERSION",
            "WHATSAPP_WEB_IDLE_MINUTES",
            "WHATSAPP_WEB_MIN_SEND_INTERVAL_SECONDS",
            "WHATSAPP_WEB_DAILY_SEND_LIMIT",
            "WHATSAPP_WEB_ALLOWED_FILE_DIRS",
            "WHATSAPP_WEB_PROFILE_DIR",
            "META_GRAPH_VERSION",
            "GOOGLE_MAPS_LANGUAGE",
            "WHATSAPP_TOOL_ALLOW_SEND",
            "STRIPE_TOOL_MAX_AMOUNT",
        ] {
            assert!(guess_from_name(optional).optional, "{optional}");
        }
        for required in ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_PAGE_ID", "X_CLIENT_SECRET"] {
            let guess = guess_from_name(required);
            assert!(!guess.optional, "{required}");
            assert_eq!(guess.kind, SettingKind::Secret, "{required}");
        }
    }

    /// The report that started this: document-templates 0.1.0 declares nothing, and its six
    /// limits were asked for as if they were credentials.
    #[test]
    fn the_limits_of_a_plugin_that_declares_nothing_are_not_asked_for() {
        for limit in [
            "DOCUMENT_TEMPLATES_MAX_INPUT_BYTES",
            "DOCUMENT_TEMPLATES_MAX_OUTPUT_BYTES",
            "DOCUMENT_TEMPLATES_MAX_PAGES",
            "DOCUMENT_TEMPLATES_TIMEOUT_MS",
            "DOCUMENT_TEMPLATES_MAX_MEMORY_MB",
        ] {
            let guess = guess_from_name(limit);
            assert!(guess.optional, "{limit}");
            assert_eq!(guess.kind, SettingKind::Number, "{limit}");
        }
        assert!(guess_from_name("DOCUMENT_TEMPLATES_FONTS").optional);
    }

    #[test]
    fn folders_are_recognised_with_lists_of_them() {
        let one = guess_from_name("DOCUMENT_TEMPLATES_OUTPUT_DIR");
        assert_eq!((one.kind, one.multiple), (SettingKind::Folder, false));
        let several = guess_from_name("DOCUMENT_TEMPLATES_INPUT_DIRS");
        assert_eq!((several.kind, several.multiple), (SettingKind::Folder, true));
    }
}
