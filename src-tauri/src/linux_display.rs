//! Linux display-backend workaround for the AppImage build.
//!
//! The AppImage bundles its own GTK. On a Wayland session that bundled GTK aborts
//! during startup with the assertion
//! `_gdk_wayland_display_get_scaled_cursor_theme: assertion failed: cursor_theme_name`
//! (process exits with SIGABRT / rc 134): the bundled GTK ends up with no cursor theme
//! name, apparently because it does not pick up the host's cursor-theme setting. The
//! same app runs fine on Wayland when installed from the .deb/.rpm (system GTK), and
//! the AppImage runs fine through XWayland with `GDK_BACKEND=x11`.
//!
//! So, only for an AppImage on a Wayland session, and only when the user has not chosen
//! a backend themselves, we default GDK to X11 before any GTK code runs.

/// Environment variables the workaround reads or writes.
const APPIMAGE: &str = "APPIMAGE";
const GDK_BACKEND: &str = "GDK_BACKEND";
const WAYLAND_DISPLAY: &str = "WAYLAND_DISPLAY";
const XDG_SESSION_TYPE: &str = "XDG_SESSION_TYPE";

/// Backend forced for the AppImage on Wayland.
const FALLBACK_GDK_BACKEND: &str = "x11";

/// Returns the `GDK_BACKEND` value to set, or `None` to leave the environment alone.
///
/// Pure: `lookup` returns the value of an environment variable, or `None` when it is
/// unset. Empty values count as unset, matching how GTK and the AppImage runtime treat
/// them.
pub fn gdk_backend_override<F>(lookup: F) -> Option<&'static str>
where
    F: Fn(&str) -> Option<String>,
{
    let is_set = |name: &str| lookup(name).is_some_and(|value| !value.is_empty());

    // Respect an explicit choice, including GDK_BACKEND=wayland.
    if is_set(GDK_BACKEND) {
        return None;
    }

    // The crash is specific to the GTK bundled inside the AppImage.
    if !is_set(APPIMAGE) {
        return None;
    }

    let on_wayland =
        is_set(WAYLAND_DISPLAY) || lookup(XDG_SESSION_TYPE).is_some_and(|value| value.eq_ignore_ascii_case("wayland"));
    if !on_wayland {
        return None;
    }

    Some(FALLBACK_GDK_BACKEND)
}

/// Applies [`gdk_backend_override`] to the real process environment.
///
/// Must be called at the very start of `main`, before Tauri/GTK initialise and before
/// any other thread is spawned.
pub fn apply_appimage_wayland_workaround() {
    let lookup = |name: &str| std::env::var_os(name).map(|value| value.to_string_lossy().into_owned());
    if let Some(backend) = gdk_backend_override(lookup) {
        // SAFETY (soundness, not an `unsafe` block): `set_var` races with concurrent
        // environment reads in other threads, which is why it becomes `unsafe` in edition
        // 2024 (this crate is edition 2021). This runs as the first statement of `main`,
        // while the process is still single-threaded and before GTK reads its environment.
        std::env::set_var(GDK_BACKEND, backend);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn decide(vars: &[(&str, &str)]) -> Option<&'static str> {
        let env: HashMap<String, String> =
            vars.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())).collect();
        gdk_backend_override(|name| env.get(name).cloned())
    }

    const APPIMAGE_PATH: (&str, &str) = (APPIMAGE, "/home/u/GraphRT.AppImage");

    #[test]
    fn appimage_on_wayland_display_forces_x11() {
        assert_eq!(decide(&[APPIMAGE_PATH, (WAYLAND_DISPLAY, "wayland-0")]), Some("x11"));
    }

    #[test]
    fn appimage_on_wayland_session_type_forces_x11() {
        assert_eq!(decide(&[APPIMAGE_PATH, (XDG_SESSION_TYPE, "wayland")]), Some("x11"));
        assert_eq!(decide(&[APPIMAGE_PATH, (XDG_SESSION_TYPE, "Wayland")]), Some("x11"));
    }

    #[test]
    fn user_choice_is_respected() {
        let wayland = [APPIMAGE_PATH, (WAYLAND_DISPLAY, "wayland-0"), (XDG_SESSION_TYPE, "wayland")];
        assert_eq!(decide(&[wayland[0], wayland[1], wayland[2], (GDK_BACKEND, "wayland")]), None);
        assert_eq!(decide(&[wayland[0], wayland[1], wayland[2], (GDK_BACKEND, "x11")]), None);
    }

    #[test]
    fn empty_gdk_backend_counts_as_unset() {
        assert_eq!(decide(&[APPIMAGE_PATH, (WAYLAND_DISPLAY, "wayland-0"), (GDK_BACKEND, "")]), Some("x11"));
    }

    #[test]
    fn not_an_appimage_is_untouched() {
        assert_eq!(decide(&[(WAYLAND_DISPLAY, "wayland-0"), (XDG_SESSION_TYPE, "wayland")]), None);
        assert_eq!(decide(&[(APPIMAGE, ""), (WAYLAND_DISPLAY, "wayland-0")]), None);
    }

    #[test]
    fn appimage_on_x11_is_untouched() {
        assert_eq!(decide(&[APPIMAGE_PATH, (XDG_SESSION_TYPE, "x11"), ("DISPLAY", ":0")]), None);
        assert_eq!(decide(&[APPIMAGE_PATH]), None);
        assert_eq!(decide(&[APPIMAGE_PATH, (WAYLAND_DISPLAY, "")]), None);
    }
}
