//! The environment for programs graphrt starts (local CLIs, Node.js, `xdg-open`,
//! `systemd-inhibit`, …), without what the AppImage launcher added for graphrt itself.
//!
//! The Linux AppImage's `AppRun` puts the bundle's folders in front of `PATH`,
//! `LD_LIBRARY_PATH`, `PYTHONPATH`, `XDG_DATA_DIRS`, … and its GTK hook points
//! `GTK_PATH`, `GIO_MODULE_DIR`, `GDK_PIXBUF_MODULE_FILE`, … into the bundle. graphrt
//! needs them, but a program of the computer started with them loads graphrt's older
//! bundled libraries and fails (e.g. ``libsystemd.so.0: version `LIBSYSTEMD_254' not
//! found`` for Codex on Ubuntu 26.04). The launcher keeps no copy of the original values,
//! so every entry inside the bundle (`$APPDIR`) is dropped instead: a list variable keeps
//! its other entries, a variable with nothing left is removed.
//!
//! Outside an AppImage (and on macOS / Windows) nothing changes.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Set by the AppImage runtime; meaningless (or misleading) for other programs.
const APPIMAGE_RUNTIME_VARS: &[&str] = &["APPIMAGE", "ARGV0", "OWD"];

/// One change to a child's environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvFix {
    Set(OsString, OsString),
    Remove(OsString),
}

/// The changes that give a child the computer's own environment back.
///
/// @param vars - The current environment (name, value)
/// @param appdir - The mounted AppImage folder (`$APPDIR`)
/// @returns One fix per variable that points into `appdir`, sorted by name
pub fn appimage_env_fixes(vars: impl IntoIterator<Item = (OsString, OsString)>, appdir: &Path) -> Vec<EnvFix> {
    let mut fixes: Vec<EnvFix> = vars
        .into_iter()
        .filter_map(|(name, value)| {
            if APPIMAGE_RUNTIME_VARS.iter().any(|runtime_var| OsStr::new(runtime_var) == name) {
                return Some(EnvFix::Remove(name));
            }
            let entries = split_entries(&name, &value);
            if !entries.iter().any(|entry| is_inside(entry, appdir)) {
                return None;
            }
            let kept: Vec<&OsStr> =
                entries.into_iter().filter(|entry| !entry.is_empty() && !is_inside(entry, appdir)).collect();
            if kept.is_empty() {
                return Some(EnvFix::Remove(name));
            }
            Some(EnvFix::Set(name, join_entries(&kept)))
        })
        .collect();
    fixes.sort_by(|left, right| fix_name(left).cmp(fix_name(right)));
    fixes
}

fn fix_name(fix: &EnvFix) -> &OsStr {
    match fix {
        EnvFix::Set(name, _) | EnvFix::Remove(name) => name,
    }
}

/// A value's `:`-separated entries (`LD_PRELOAD` also splits on spaces, like the loader).
#[cfg(unix)]
fn split_entries<'a>(name: &OsStr, value: &'a OsStr) -> Vec<&'a OsStr> {
    use std::os::unix::ffi::OsStrExt;
    let bytes = value.as_bytes();
    let is_separator = |byte: &u8| *byte == b':' || (name == "LD_PRELOAD" && byte.is_ascii_whitespace());
    bytes.split(is_separator).map(OsStr::from_bytes).collect()
}

#[cfg(not(unix))]
fn split_entries<'a>(_name: &OsStr, value: &'a OsStr) -> Vec<&'a OsStr> {
    vec![value]
}

fn join_entries(entries: &[&OsStr]) -> OsString {
    let mut joined = OsString::new();
    for (index, entry) in entries.iter().enumerate() {
        if index > 0 {
            joined.push(":");
        }
        joined.push(entry);
    }
    joined
}

/// Whether `entry` is an absolute path in `appdir` (`$APPDIR//usr/lib` included).
fn is_inside(entry: &OsStr, appdir: &Path) -> bool {
    let entry = Path::new(entry);
    entry.is_absolute() && entry.starts_with(appdir)
}

/// The AppImage folder graphrt runs from: `$APPDIR`, but only when graphrt's own binary
/// is inside it (a stray `APPDIR` in the user's shell changes nothing).
fn running_appdir(appdir_var: Option<OsString>, current_exe: Option<PathBuf>) -> Option<PathBuf> {
    let appdir = PathBuf::from(appdir_var?);
    let is_mounted_bundle = appdir.is_absolute() && appdir.parent().is_some() && current_exe?.starts_with(&appdir);
    is_mounted_bundle.then_some(appdir)
}

/// The fixes for this process, worked out once (empty outside a Linux AppImage).
pub fn host_env_fixes() -> &'static [EnvFix] {
    static FIXES: OnceLock<Vec<EnvFix>> = OnceLock::new();
    FIXES.get_or_init(|| {
        if !cfg!(target_os = "linux") {
            return Vec::new();
        }
        let Some(appdir) = running_appdir(std::env::var_os("APPDIR"), std::env::current_exe().ok()) else {
            return Vec::new();
        };
        let fixes = appimage_env_fixes(std::env::vars_os(), &appdir);
        log::info!(
            "running from an AppImage: {} environment variables are restored for programs graphrt starts",
            fixes.len()
        );
        fixes
    })
}

/// `name` as a child gets it: the process value with the AppImage fixes applied.
pub fn host_var(name: &str) -> Option<OsString> {
    let fix = host_env_fixes().iter().find(|fix| fix_name(fix) == name);
    match fix {
        Some(EnvFix::Set(_, value)) => Some(value.clone()),
        Some(EnvFix::Remove(_)) => None,
        None => std::env::var_os(name),
    }
}

/// The whole environment as a child gets it (for commands that start from a cleared one).
pub fn host_vars() -> Vec<(OsString, OsString)> {
    let fixes = host_env_fixes();
    std::env::vars_os()
        .filter_map(|(name, value)| match fixes.iter().find(|fix| fix_name(fix) == name.as_os_str()) {
            Some(EnvFix::Set(_, fixed)) => Some((name, fixed.clone())),
            Some(EnvFix::Remove(_)) => None,
            None => Some((name, value)),
        })
        .collect()
}

/// Gives a `std` command the computer's own environment (call before its own `env`s).
pub fn apply(command: &mut std::process::Command) {
    apply_fixes(command, host_env_fixes());
}

fn apply_fixes(command: &mut std::process::Command, fixes: &[EnvFix]) {
    for fix in fixes {
        match fix {
            EnvFix::Set(name, value) => command.env(name, value),
            EnvFix::Remove(name) => command.env_remove(name),
        };
    }
}

/// [`apply`] for a Tokio command.
pub fn apply_tokio(command: &mut tokio::process::Command) {
    apply(command.as_std_mut());
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const APPDIR: &str = "/tmp/.mount_graphremPBnj";

    fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(name, value)| (OsString::from(name), OsString::from(value))).collect()
    }

    fn set(name: &str, value: &str) -> EnvFix {
        EnvFix::Set(name.into(), value.into())
    }

    fn remove(name: &str) -> EnvFix {
        EnvFix::Remove(name.into())
    }

    #[test]
    fn drops_bundle_entries_from_lists_and_keeps_the_rest() {
        let env = vars(&[
            ("PATH", "/tmp/.mount_graphremPBnj/usr/bin/:/tmp/.mount_graphremPBnj/usr/sbin/:/usr/local/bin:/usr/bin"),
            ("XDG_DATA_DIRS", "/tmp/.mount_graphremPBnj/usr/share/:/tmp/.mount_graphremPBnj/usr/share:/usr/share:/var/lib/flatpak/exports/share"),
            ("LD_LIBRARY_PATH", "/tmp/.mount_graphremPBnj/usr/lib/:/tmp/.mount_graphremPBnj/lib64/:/opt/cuda/lib64"),
        ]);
        let fixes = appimage_env_fixes(env, Path::new(APPDIR));
        assert_eq!(
            fixes,
            vec![
                set("LD_LIBRARY_PATH", "/opt/cuda/lib64"),
                set("PATH", "/usr/local/bin:/usr/bin"),
                set("XDG_DATA_DIRS", "/usr/share:/var/lib/flatpak/exports/share"),
            ]
        );
    }

    #[test]
    fn removes_variables_left_empty_and_single_bundle_paths() {
        // AppRun ends each list with the old value, which is empty when it was unset.
        let env = vars(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_graphremPBnj/usr/lib/:/tmp/.mount_graphremPBnj/usr/lib64/:"),
            ("PYTHONHOME", "/tmp/.mount_graphremPBnj/usr/"),
            ("GIO_MODULE_DIR", "/tmp/.mount_graphremPBnj//usr/lib/gio/modules"),
            ("GDK_PIXBUF_MODULE_FILE", "/tmp/.mount_graphremPBnj//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"),
            ("APPDIR", APPDIR),
        ]);
        let fixes = appimage_env_fixes(env, Path::new(APPDIR));
        assert_eq!(
            fixes,
            vec![
                remove("APPDIR"),
                remove("GDK_PIXBUF_MODULE_FILE"),
                remove("GIO_MODULE_DIR"),
                remove("LD_LIBRARY_PATH"),
                remove("PYTHONHOME")
            ]
        );
    }

    #[test]
    fn removes_the_appimage_runtime_variables() {
        let env = vars(&[
            ("APPIMAGE", "/home/me/Downloads/graphrt.AppImage"),
            ("ARGV0", "./graphrt.AppImage"),
            ("OWD", "/home/me"),
        ]);
        assert_eq!(
            appimage_env_fixes(env, Path::new(APPDIR)),
            vec![remove("APPIMAGE"), remove("ARGV0"), remove("OWD")]
        );
    }

    #[test]
    fn leaves_everything_else_alone() {
        let env = vars(&[
            ("HOME", "/home/me"),
            ("PATH", "/usr/local/bin:/usr/bin"),
            ("GTK_THEME", "Adwaita:dark"),
            ("PYTHONDONTWRITEBYTECODE", "1"),
            // Same prefix, different folder.
            ("SOME_DIR", "/tmp/.mount_graphremPBnjX/usr/lib"),
            // Relative entries never count as the bundle.
            ("CDPATH", "tmp/.mount_graphremPBnj:."),
            ("URL", "https://example.com:8443/tmp/.mount_graphremPBnj"),
        ]);
        assert!(appimage_env_fixes(env, Path::new(APPDIR)).is_empty());
    }

    #[test]
    fn ld_preload_splits_on_spaces_too() {
        let env = vars(&[("LD_PRELOAD", "/tmp/.mount_graphremPBnj/usr/lib/libhack.so /usr/lib/libgamemodeauto.so.0")]);
        assert_eq!(
            appimage_env_fixes(env, Path::new(APPDIR)),
            vec![set("LD_PRELOAD", "/usr/lib/libgamemodeauto.so.0")]
        );
    }

    #[test]
    fn appdir_counts_only_when_graphrt_runs_from_it() {
        let exe_inside = Some(PathBuf::from("/tmp/.mount_graphremPBnj/usr/bin/graphrt"));
        assert_eq!(running_appdir(Some(APPDIR.into()), exe_inside.clone()), Some(PathBuf::from(APPDIR)));
        assert_eq!(running_appdir(Some(APPDIR.into()), Some(PathBuf::from("/usr/bin/graphrt"))), None);
        assert_eq!(running_appdir(None, exe_inside.clone()), None);
        assert_eq!(running_appdir(Some("relative/dir".into()), exe_inside.clone()), None);
        assert_eq!(running_appdir(Some("/".into()), exe_inside), None);
        assert_eq!(running_appdir(Some(APPDIR.into()), None), None);
    }

    #[test]
    fn apply_sets_and_removes_on_the_command() {
        let mut command = std::process::Command::new("true");
        apply_fixes(&mut command, &[set("PATH", "/usr/bin"), remove("LD_LIBRARY_PATH")]);
        let envs: Vec<(&OsStr, Option<&OsStr>)> = command.get_envs().collect();
        assert_eq!(
            envs,
            vec![(OsStr::new("LD_LIBRARY_PATH"), None), (OsStr::new("PATH"), Some(OsStr::new("/usr/bin")))]
        );
    }

    #[test]
    fn nothing_changes_outside_an_appimage() {
        // The test runner is not an AppImage.
        assert!(host_env_fixes().is_empty());
        assert_eq!(host_var("HOME"), std::env::var_os("HOME"));
    }
}
