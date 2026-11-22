//! Finding the Claude Code / Codex binaries and what they support.
//!
//! GUI apps on macOS (and some Linux desktops) do not inherit the shell `PATH`, so
//! besides `PATH` the common install folders are searched, and on macOS/Linux the
//! user's login shell is asked once for its `PATH`. Only the binaries' own
//! `--version`, `--help` and sign-in status commands are run: none of them spends
//! usage, and their output is never logged (status commands print account details).

use std::collections::{BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::process::run_quick;
use super::{LocalCli, SignInState};

/// How long a detection result is reused before looking again.
const DETECTION_TTL: Duration = Duration::from_secs(5 * 60);
const QUICK_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(5);
/// Marker in front of the login shell's `PATH`, so profile scripts printing text do not confuse it.
const PATH_MARKER: &str = "__GRAPHRT_PATH__";

/// What was found about one CLI.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Detection {
    /// The binary, when found.
    pub binary: Option<PathBuf>,
    /// First line of `--version`.
    pub version: Option<String>,
    pub sign_in: SignInState,
    /// `PATH` for the CLI's process (npm-installed CLIs need `node` from it).
    pub child_path: Option<OsString>,
    /// Every `--flag` the CLI's help lists (Claude Code: `claude --help`; Codex: `codex exec --help`).
    pub flags: BTreeSet<String>,
    /// Model aliases Claude Code's help names for `--model` (e.g. `sonnet`, `opus`).
    pub model_aliases: Vec<String>,
}

impl Detection {
    /// Whether the help lists `flag` (e.g. `--safe-mode`).
    pub fn supports(&self, flag: &str) -> bool {
        self.flags.contains(flag)
    }
}

/// Where to look for binaries.
#[derive(Debug, Clone, Default)]
pub struct Locator {
    /// The process `PATH`.
    pub path_var: Option<OsString>,
    /// The login shell's `PATH` (macOS/Linux GUI apps), when known.
    pub login_shell_path: Option<OsString>,
    /// Common install folders, searched after both `PATH`s.
    pub extra_dirs: Vec<PathBuf>,
}

impl Locator {
    /// The real environment: process `PATH`, the login shell's `PATH` and common folders.
    pub fn from_environment() -> Self {
        let home = home_dir();
        Self {
            path_var: std::env::var_os("PATH"),
            login_shell_path: login_shell_path(),
            extra_dirs: home.as_deref().map(common_install_dirs).unwrap_or_default(),
        }
    }

    /// Every folder to search, in order, without duplicates.
    fn search_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        let path_dirs = [&self.path_var, &self.login_shell_path]
            .into_iter()
            .flatten()
            .flat_map(|path_var| std::env::split_paths(path_var).collect::<Vec<_>>());
        for dir in path_dirs.chain(self.extra_dirs.iter().cloned()) {
            if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
        dirs
    }

    /// `PATH` for a CLI process: the binary's folder first, then every searched folder.
    fn child_path(&self, binary: &Path) -> Option<OsString> {
        let mut dirs = self.search_dirs();
        if let Some(binary_dir) = binary.parent() {
            dirs.retain(|dir| dir != binary_dir);
            dirs.insert(0, binary_dir.to_path_buf());
        }
        std::env::join_paths(dirs).ok()
    }
}

/// Finds and inspects `cli`.
pub fn detect(cli: LocalCli, locator: &Locator) -> Detection {
    let Some(binary) = find_binary(cli, locator) else {
        return Detection::default();
    };
    let child_path = locator.child_path(&binary);
    let path_env = child_path.as_deref();
    let version = run_quick(&binary, &["--version"], path_env, QUICK_COMMAND_TIMEOUT)
        .and_then(|output| first_line(&output.stdout).or_else(|| first_line(&output.stderr)));
    let help_args: &[&str] = match cli {
        LocalCli::ClaudeCode => &["--help"],
        LocalCli::Codex => &["exec", "--help"],
    };
    let help =
        run_quick(&binary, help_args, path_env, QUICK_COMMAND_TIMEOUT).map(|output| output.stdout).unwrap_or_default();
    let sign_in = read_sign_in(cli, &binary, path_env);
    let model_aliases = if cli == LocalCli::ClaudeCode { claude_model_aliases(&help) } else { Vec::new() };
    Detection { flags: help_flags(&help), binary: Some(binary), version, sign_in, child_path, model_aliases }
}

/// Detections by CLI, with when each was made.
type DetectionCache = HashMap<LocalCli, (Instant, Arc<Detection>)>;

/// The cached detection of `cli`; `refresh` (or an expired entry) detects again.
pub fn cached(cli: LocalCli, refresh: bool) -> Arc<Detection> {
    static CACHE: Mutex<Option<DetectionCache>> = Mutex::new(None);
    if !refresh {
        if let Ok(cache) = CACHE.lock() {
            let fresh = cache
                .as_ref()
                .and_then(|entries| entries.get(&cli))
                .filter(|(detected_at, _)| detected_at.elapsed() < DETECTION_TTL);
            if let Some((_, detection)) = fresh {
                return detection.clone();
            }
        }
    }
    // Tests never run the real CLIs of the computer they run on.
    let locator = if cfg!(test) { Locator::default() } else { Locator::from_environment() };
    let detection = Arc::new(detect(cli, &locator));
    log::info!(
        "{}: {}",
        cli.display_name(),
        if detection.binary.is_some() { "found on this computer" } else { "not installed" }
    );
    if let Ok(mut cache) = CACHE.lock() {
        cache.get_or_insert_with(HashMap::new).insert(cli, (Instant::now(), detection.clone()));
    }
    detection
}

/// The first executable named like `cli` in the locator's folders.
pub fn find_binary(cli: LocalCli, locator: &Locator) -> Option<PathBuf> {
    let names = executable_names(cli.binary_name());
    locator
        .search_dirs()
        .into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| is_executable(candidate))
}

fn executable_names(binary_name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{binary_name}.exe"), format!("{binary_name}.cmd")]
    } else {
        vec![binary_name.to_owned()]
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
}

/// Folders the official installers and package managers put CLIs in.
pub fn common_install_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join(".claude").join("local"),
        home.join(".local").join("bin"),
        home.join(".npm-global").join("bin"),
        home.join(".bun").join("bin"),
        home.join(".volta").join("bin"),
    ];
    if cfg!(windows) {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(app_data).join("npm"));
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        dirs.extend(nvm_node_bin_dirs(home));
    }
    dirs
}

/// `~/.nvm/versions/node/<version>/bin`, newest version first.
fn nvm_node_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home.join(".nvm").join("versions").join("node")) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|entry| entry.path().join("bin")).collect();
    dirs.sort();
    dirs.reverse();
    dirs
}

/// The login shell's `PATH`, asked once per app start (macOS/Linux; not in tests).
fn login_shell_path() -> Option<OsString> {
    if cfg!(any(windows, test)) {
        return None;
    }
    static LOGIN_SHELL_PATH: OnceLock<Option<OsString>> = OnceLock::new();
    LOGIN_SHELL_PATH.get_or_init(read_login_shell_path).clone()
}

fn read_login_shell_path() -> Option<OsString> {
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|shell| shell.is_absolute())
        .unwrap_or_else(|| PathBuf::from(if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/sh" }));
    let script = format!("printf '{PATH_MARKER}%s' \"$PATH\"");
    let output = run_quick(&shell, &["-lc", &script], None, LOGIN_SHELL_TIMEOUT)?;
    parse_login_shell_path(&output.stdout)
}

/// The `PATH` after the marker in a login shell's output.
pub fn parse_login_shell_path(output: &str) -> Option<OsString> {
    let path = output.rsplit_once(PATH_MARKER)?.1.lines().next()?.trim();
    (!path.is_empty()).then(|| OsString::from(path))
}

fn first_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|line| !line.is_empty()).map(|line| line.chars().take(120).collect())
}

/// Every `--flag` named in a help text.
pub fn help_flags(help: &str) -> BTreeSet<String> {
    static FLAG: OnceLock<regex::Regex> = OnceLock::new();
    let flag = FLAG.get_or_init(|| regex::Regex::new(r"--[a-zA-Z][a-zA-Z0-9-]*").expect("flag pattern is valid"));
    flag.find_iter(help).map(|found| found.as_str().to_owned()).collect()
}

/// The quoted aliases in the `--model` description of `claude --help`
/// ("Use an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')").
pub fn claude_model_aliases(help: &str) -> Vec<String> {
    static ALIAS: OnceLock<regex::Regex> = OnceLock::new();
    let alias = ALIAS.get_or_init(|| regex::Regex::new(r"'([a-z][a-z0-9.-]*)'").expect("alias pattern is valid"));
    let Some((_, after_flag)) = help.split_once("--model <") else {
        return Vec::new();
    };
    let description = after_flag.split("\n  -").next().unwrap_or_default();
    alias.captures_iter(description).map(|captures| captures[1].to_owned()).collect()
}

/// The CLI's own sign-in status command; anything unreadable is `Unknown`.
fn read_sign_in(cli: LocalCli, binary: &Path, path_env: Option<&OsStr>) -> SignInState {
    let args: &[&str] = match cli {
        LocalCli::ClaudeCode => &["auth", "status", "--json"],
        LocalCli::Codex => &["login", "status"],
    };
    match run_quick(binary, args, path_env, QUICK_COMMAND_TIMEOUT) {
        Some(output) => match cli {
            LocalCli::ClaudeCode => parse_claude_auth_status(&output.stdout),
            LocalCli::Codex => {
                parse_codex_login_status(output.success, &format!("{}\n{}", output.stdout, output.stderr))
            }
        },
        None => SignInState::Unknown,
    }
}

/// `claude auth status --json`: only `loggedIn` is read (the rest names the account).
pub fn parse_claude_auth_status(stdout: &str) -> SignInState {
    let logged_in = serde_json::from_str::<serde_json::Value>(stdout.trim())
        .ok()
        .and_then(|status| status.get("loggedIn").and_then(serde_json::Value::as_bool));
    match logged_in {
        Some(true) => SignInState::SignedIn,
        Some(false) => SignInState::SignedOut,
        None => SignInState::Unknown,
    }
}

/// `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1).
pub fn parse_codex_login_status(success: bool, output: &str) -> SignInState {
    let lowered = output.to_ascii_lowercase();
    if lowered.contains("not logged in") {
        SignInState::SignedOut
    } else if success && lowered.contains("logged in") {
        SignInState::SignedIn
    } else {
        SignInState::Unknown
    }
}
