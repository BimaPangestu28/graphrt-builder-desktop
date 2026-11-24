//! The environment for programs graphrt starts (local CLIs, Node.js, `xdg-open`,
//! `systemd-inhibit`, …), without what the AppImage launcher added for graphrt itself.
//!
//! The Linux AppImage's `AppRun` puts the bundle's folders in front of `PATH`,
//! `LD_LIBRARY_PATH`, `PYTHONPATH`, `XDG_DATA_DIRS`, … and its GTK hook points
//! `GTK_PATH`, `GIO_MODULE_DIR`, `GDK_PIXBUF_MODULE_FILE`, … into the bundle. graphrt
//! needs them, but a program of the computer started with them loads graphrt's older
//! bundled libraries and fails (e.g. ``libsystemd.so.0: version `LIBSYSTEMD_254' not
//! found`` for Codex on Ubuntu 26.04).
//!
//! The rules live in [`graphrt_core::child_env`], which also applies them to what the
//! graphrt crates start themselves (plugin processes, stdio MCP servers, `kill`,
//! `git`): every entry inside the bundle (`$APPDIR`) is dropped, a list variable keeps
//! its other entries, a variable with nothing left is removed. This module is the
//! app's entry point to them. Outside an AppImage (and on macOS / Windows) nothing
//! changes.

use std::ffi::OsString;
use std::sync::Once;

pub use graphrt_core::child_env::{host_var, host_vars, EnvFix};

/// The fixes for this process (empty outside a Linux AppImage); logged once.
pub fn host_env_fixes() -> &'static [EnvFix] {
    let fixes = graphrt_core::child_env::host_env_fixes();
    static LOGGED: Once = Once::new();
    LOGGED.call_once(|| {
        if !fixes.is_empty() {
            log::info!(
                "running from an AppImage: {} environment variables are restored for programs graphrt starts",
                fixes.len()
            );
        }
    });
    fixes
}

/// Gives a `std` command the computer's own environment (call before its own `env`s).
pub fn apply(command: &mut std::process::Command) {
    graphrt_core::child_env::apply_env_fixes(command, host_env_fixes());
}

/// [`apply`] for a Tokio command.
pub fn apply_tokio(command: &mut tokio::process::Command) {
    apply(command.as_std_mut());
}

/// `PATH` as a child gets it, as text (MCP server configs hold strings).
pub fn host_path_string() -> Option<String> {
    host_var("PATH").and_then(|path: OsString| path.into_string().ok())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;

    #[test]
    fn nothing_changes_outside_an_appimage() {
        // The test runner is not an AppImage.
        assert!(host_env_fixes().is_empty());
        assert_eq!(host_var("HOME"), std::env::var_os("HOME"));
        assert_eq!(host_path_string(), std::env::var("PATH").ok());
        let mut command = std::process::Command::new("true");
        apply(&mut command);
        assert_eq!(command.get_envs().count(), 0);
    }

    /// The app's wrappers apply graphrt-core's rules: one AppImage environment end to end.
    #[cfg(unix)]
    #[test]
    fn the_appimage_rules_come_from_graphrt_core() {
        let appdir = std::path::Path::new("/tmp/.mount_graphremPBnj");
        let vars = [
            ("LD_LIBRARY_PATH", "/tmp/.mount_graphremPBnj/usr/lib/:/tmp/.mount_graphremPBnj/usr/lib64/:"),
            ("PATH", "/tmp/.mount_graphremPBnj/usr/bin/:/usr/local/bin:/usr/bin"),
            ("PYTHONHOME", "/tmp/.mount_graphremPBnj/usr/"),
            ("HOME", "/home/me"),
        ]
        .map(|(name, value)| (OsString::from(name), OsString::from(value)));
        let fixes = graphrt_core::child_env::appimage_env_fixes(vars, appdir);
        let mut command = std::process::Command::new("codex");
        graphrt_core::child_env::apply_env_fixes(&mut command, &fixes);
        let envs: Vec<(&OsStr, Option<&OsStr>)> = command.get_envs().collect();
        assert_eq!(
            envs,
            vec![
                (OsStr::new("LD_LIBRARY_PATH"), None),
                (OsStr::new("PATH"), Some(OsStr::new("/usr/local/bin:/usr/bin"))),
                (OsStr::new("PYTHONHOME"), None),
            ]
        );
    }
}
