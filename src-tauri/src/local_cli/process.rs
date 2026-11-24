//! Short blocking subprocess runs for detection (`--version`, `--help`, status commands).

use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Output of a finished quick command. Never logged: status commands may print account details.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QuickOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Most a quick command may print; detection output is a few kilobytes.
const MAX_QUICK_OUTPUT_BYTES: u64 = 1024 * 1024;

/// Runs `program args` with `path_env` as `PATH`, stdin closed, and waits at most
/// `timeout` (the process is killed after that).
///
/// @returns `None` when it cannot start or does not finish in time.
pub fn run_quick(program: &Path, args: &[&str], path_env: Option<&OsStr>, timeout: Duration) -> Option<QuickOutput> {
    let mut command = Command::new(program);
    crate::child_env::apply(&mut command);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    hide_console_window(&mut command);
    let mut child = command.spawn().ok()?;
    let stdout_reader = spawn_reader(child.stdout.take());
    let stderr_reader = spawn_reader(child.stderr.take());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(15)),
            Ok(None) | Err(_) => {
                let _kill_result = child.kill();
                let _wait_result = child.wait();
                return None;
            }
        }
    };
    Some(QuickOutput {
        success: status.success(),
        stdout: stdout_reader.join().unwrap_or_default(),
        stderr: stderr_reader.join().unwrap_or_default(),
    })
}

fn spawn_reader(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(pipe) = pipe {
            let _read_result = pipe.take(MAX_QUICK_OUTPUT_BYTES).read_to_string(&mut text);
        }
        text
    })
}

/// No console window flashing up on Windows for each detection command.
#[cfg(windows)]
pub fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console_window(_command: &mut Command) {}
