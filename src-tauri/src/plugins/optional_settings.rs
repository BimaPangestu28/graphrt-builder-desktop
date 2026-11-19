//! Which plugin settings are optional tuning. Plugin manifests and the catalog declare one
//! flat `permissions.env` list with no optional marker, so name endings stand in for that.
//! Shared by readiness (`requirements.rs`), the installed plugin listing (each setting's
//! `optional` flag, so Connections can tuck them away) and the Problems check.

/// Requested variables ending in this get a default folder from the app, so they are never missing.
const PROFILE_DIR_SUFFIX: &str = "_PROFILE_DIR";

/// Tuning settings the plugins default themselves (API version, idle minutes, send interval,
/// daily limit, allowed folders). They never block "ready" and stay editable in Connections.
const OPTIONAL_SETTING_SUFFIXES: &[&str] =
    &["_VERSION", "_MINUTES", "_SECONDS", "_LIMIT", "_DIR", "_DIRS", "_INTERVAL", "_LANGUAGE"];

/// Whether a plugin works without `variable` set (it has a default).
pub(crate) fn is_optional_setting(variable: &str) -> bool {
    variable.ends_with(PROFILE_DIR_SUFFIX) || OPTIONAL_SETTING_SUFFIXES.iter().any(|suffix| variable.ends_with(suffix))
}

#[cfg(test)]
mod tests {
    use super::is_optional_setting;

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
        ] {
            assert!(is_optional_setting(optional), "{optional}");
        }
        for required in ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_PAGE_ID", "X_CLIENT_SECRET"] {
            assert!(!is_optional_setting(required), "{required}");
        }
    }
}
