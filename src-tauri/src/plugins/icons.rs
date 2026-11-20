//! Plugin icons: the SVG a catalog entry links to (`icon_url`), downloaded once
//! over HTTPS (size-capped), kept on disk next to the catalog cache and handed
//! to the UI as a `data:image/svg+xml;base64,...` URL.
//!
//! SVG can carry scripts, so the UI only ever renders these in `<img>`, where
//! browsers never run them; the CSP's `img-src 'self' data:` stays as it is
//! instead of allowing remote images from GitHub.
//!
//! Each cached file is named after the plugin and a hash of the icon URL, so a
//! new URL in the catalog fetches the new icon while an unchanged one keeps
//! working offline.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;

use super::archive::sha256_hex;

/// Folder under the app data folder holding the downloaded icons.
pub(super) const ICONS_DIR_NAME: &str = "plugin-icons";
/// Largest icon accepted: catalog icons are small hand-made SVGs.
pub(super) const MAX_ICON_BYTES: u64 = 64 * 1024;
/// How long one icon download may take.
pub(super) const ICON_TIMEOUT: Duration = Duration::from_secs(10);
/// Hex characters of the URL hash kept in the file name.
const URL_HASH_LENGTH: usize = 16;

/// The cache file for `plugin_name`'s icon at `icon_url`. `plugin_name` must
/// already be a valid plugin name (no path separators).
pub(super) fn cached_icon_path(icons_dir: &Path, plugin_name: &str, icon_url: &str) -> PathBuf {
    let url_hash = &sha256_hex(icon_url.as_bytes())[..URL_HASH_LENGTH];
    icons_dir.join(format!("{plugin_name}-{url_hash}.svg"))
}

/// The saved icon, if there is one and it still looks like an SVG.
pub(super) fn read_cached_icon(cache_file: &Path) -> Option<Vec<u8>> {
    let bytes = std::fs::read(cache_file).ok()?;
    if looks_like_svg(&bytes) {
        Some(bytes)
    } else {
        log::warn!("ignoring the saved plugin icon {}: not an SVG", cache_file.display());
        None
    }
}

/// Saves an icon (written then renamed) and removes `plugin_name`'s icons for
/// other URLs. Failures are logged: the icon is still shown this session.
pub(super) fn write_cached_icon(icons_dir: &Path, plugin_name: &str, cache_file: &Path, bytes: &[u8]) {
    if let Err(error) = std::fs::create_dir_all(icons_dir) {
        log::warn!("could not create the plugin icon folder: {error}");
        return;
    }
    remove_stale_icons(icons_dir, plugin_name, cache_file);
    let temporary = cache_file.with_extension("svg.tmp");
    let result = std::fs::write(&temporary, bytes).and_then(|()| std::fs::rename(&temporary, cache_file));
    if let Err(error) = result {
        log::warn!("could not save the icon of plugin {plugin_name}: {error}");
    }
}

/// Removes `plugin_name`'s saved icons other than `keep` (older icon URLs).
fn remove_stale_icons(icons_dir: &Path, plugin_name: &str, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(icons_dir) else { return };
    let prefix = format!("{plugin_name}-");
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else { continue };
        let is_same_plugin =
            file_name.strip_prefix(&prefix).and_then(|rest| rest.strip_suffix(".svg")).is_some_and(|hash| {
                hash.len() == URL_HASH_LENGTH && hash.chars().all(|character| character.is_ascii_hexdigit())
            });
        if is_same_plugin && path != keep {
            if let Err(error) = std::fs::remove_file(&path) {
                log::warn!("could not remove the old icon {}: {error}", path.display());
            }
        }
    }
}

/// Whether `bytes` is UTF-8 text with an `<svg` element (not, say, an HTML error page).
pub(super) fn looks_like_svg(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok_and(|text| text.to_ascii_lowercase().contains("<svg"))
}

/// `bytes` as a `data:image/svg+xml;base64,...` URL for an `<img>`.
pub(super) fn svg_data_url(bytes: &[u8]) -> String {
    format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}
