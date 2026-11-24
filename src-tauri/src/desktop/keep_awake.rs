//! "Keep the computer awake while an agent runs".
//!
//! While at least one run is `Running` and the setting is on, graphrt holds the
//! system's own "do not sleep" assertion; it is released when the last run
//! ends, the setting is turned off, or the app exits. No extra dependency is
//! needed on macOS or Linux (system tools); Windows uses one Win32 call.
//!
//! - macOS: a child `/usr/bin/caffeinate`. `-i` prevents idle sleep; with
//!   "only while plugged in" `-s` prevents system sleep, which macOS honors
//!   only on AC power, so on battery the Mac sleeps as usual. `-w <graphrt
//!   pid>` makes it exit on its own if graphrt dies without stopping it.
//! - Windows: a background thread calls `SetThreadExecutionState` with
//!   `ES_SYSTEM_REQUIRED`. With "only while plugged in" it re-checks the power
//!   source every minute and lets the PC sleep while on battery.
//! - Linux: a child `systemd-inhibit --what=sleep:idle` (a logind inhibitor
//!   lock) around `tail --pid=<graphrt pid>`, so the lock also goes away if
//!   graphrt dies. "Only while plugged in" is checked when the lock is taken,
//!   from `/sys/class/power_supply`. Without systemd-logind the setting only
//!   logs a warning.

use std::sync::Mutex;

use super::app_settings::AppSettings;

/// Whether a power assertion should be held right now.
pub fn should_keep_awake(settings: &AppSettings, running_run_count: usize) -> bool {
    settings.keep_awake_while_running && running_run_count > 0
}

/// Arguments of `caffeinate` (macOS) for the settings, tied to the process `pid`.
pub fn caffeinate_arguments(only_on_power: bool, pid: u32) -> Vec<String> {
    let sleep_flag = if only_on_power { "-s" } else { "-i" };
    vec![sleep_flag.to_owned(), "-w".to_owned(), pid.to_string()]
}

/// Arguments of `systemd-inhibit` (Linux): block sleep and idle until process `pid` exits.
#[cfg(any(target_os = "linux", test))]
pub fn systemd_inhibit_arguments(pid: u32) -> Vec<String> {
    [
        "--what=sleep:idle",
        "--mode=block",
        "--who=graphrt",
        "--why=An agent is running",
        "tail",
        &format!("--pid={pid}"),
        "-f",
        "/dev/null",
    ]
    .iter()
    .map(|argument| (*argument).to_owned())
    .collect()
}

/// Whether a Linux machine runs on mains power, from a `/sys/class/power_supply`-like
/// folder: `Some(true)` when a `Mains` supply is online, `Some(false)` when every
/// `Mains` supply is offline, `None` when there is none (desktops, VMs).
#[cfg(any(target_os = "linux", test))]
pub fn mains_power_online(power_supply_dir: &std::path::Path) -> Option<bool> {
    let read_trimmed = |path: std::path::PathBuf| std::fs::read_to_string(path).ok().map(|text| text.trim().to_owned());
    let mut found_mains = false;
    for entry in std::fs::read_dir(power_supply_dir).ok()?.flatten() {
        if read_trimmed(entry.path().join("type")).as_deref() != Some("Mains") {
            continue;
        }
        found_mains = true;
        if read_trimmed(entry.path().join("online")).as_deref() == Some("1") {
            return Some(true);
        }
    }
    found_mains.then_some(false)
}

/// The held assertion, with the flag it was started with.
#[derive(Debug)]
struct Assertion {
    handle: platform::Handle,
    only_on_power: bool,
}

/// Holds at most one power assertion. Managed as Tauri state.
#[derive(Debug, Default)]
pub struct KeepAwake {
    assertion: Mutex<Option<Assertion>>,
}

impl KeepAwake {
    /// Starts, restarts (flag changed) or stops the assertion to match `should_be_awake`.
    pub fn update(&self, should_be_awake: bool, only_on_power: bool) {
        let Ok(mut assertion) = self.assertion.lock() else {
            log::warn!("keep-awake state lock poisoned");
            return;
        };
        let is_current = assertion.as_ref().is_some_and(|held| held.only_on_power == only_on_power);
        if should_be_awake && is_current {
            return;
        }
        if let Some(held) = assertion.take() {
            platform::stop(held.handle);
            log::info!("the computer may sleep again");
        }
        if should_be_awake {
            *assertion = platform::start(only_on_power).map(|handle| Assertion { handle, only_on_power });
        }
    }

    /// Releases the assertion (app exit).
    pub fn release(&self) {
        self.update(false, false);
    }
}

/// Stops a helper process and reaps it so it does not linger as a zombie.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn stop_child(mut child: std::process::Child, program: &str) {
    if let Err(error) = child.kill() {
        log::warn!("could not stop {program}: {error}");
    }
    let _ = child.wait();
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::{Child, Command};

    use super::{caffeinate_arguments, stop_child};

    pub type Handle = Child;

    pub fn start(only_on_power: bool) -> Option<Handle> {
        let arguments = caffeinate_arguments(only_on_power, std::process::id());
        match Command::new("/usr/bin/caffeinate").args(&arguments).spawn() {
            Ok(child) => {
                log::info!("keeping the Mac awake while agents run (caffeinate {})", arguments.join(" "));
                Some(child)
            }
            Err(error) => {
                log::warn!("could not start caffeinate: {error}");
                None
            }
        }
    }

    pub fn stop(handle: Handle) {
        stop_child(handle, "caffeinate");
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;
    use std::process::{Child, Command, Stdio};

    use super::{mains_power_online, stop_child, systemd_inhibit_arguments};

    pub type Handle = Child;

    pub fn start(only_on_power: bool) -> Option<Handle> {
        if only_on_power && mains_power_online(Path::new("/sys/class/power_supply")) == Some(false) {
            log::info!("on battery: not keeping the computer awake (only while plugged in)");
            return None;
        }
        let arguments = systemd_inhibit_arguments(std::process::id());
        let mut command = Command::new("systemd-inhibit");
        crate::child_env::apply(&mut command);
        let spawned = command.args(&arguments).stdin(Stdio::null()).stdout(Stdio::null()).spawn();
        match spawned {
            Ok(child) => {
                log::info!("keeping the computer awake while agents run (systemd-inhibit)");
                Some(child)
            }
            Err(error) => {
                log::warn!("could not start systemd-inhibit (is systemd-logind available?): {error}");
                None
            }
        }
    }

    pub fn stop(handle: Handle) {
        stop_child(handle, "systemd-inhibit");
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::thread::JoinHandle;
    use std::time::Duration;

    use windows_sys::Win32::System::Power::{
        GetSystemPowerStatus, SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SYSTEM_POWER_STATUS,
    };

    /// How often "only while plugged in" re-checks the power source.
    const POWER_CHECK_INTERVAL: Duration = Duration::from_secs(60);

    /// The thread holding the execution state, and the channel that stops it.
    #[derive(Debug)]
    pub struct Handle {
        stop_sender: Sender<()>,
        thread: JoinHandle<()>,
    }

    pub fn start(only_on_power: bool) -> Option<Handle> {
        let (stop_sender, stop_receiver) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || hold_awake(only_on_power, &stop_receiver));
        match spawned {
            Ok(thread) => {
                log::info!("keeping the PC awake while agents run");
                Some(Handle { stop_sender, thread })
            }
            Err(error) => {
                log::warn!("could not start the keep-awake thread: {error}");
                None
            }
        }
    }

    pub fn stop(handle: Handle) {
        // A closed channel also ends the thread, so a failed send is harmless.
        let _ = handle.stop_sender.send(());
        if handle.thread.join().is_err() {
            log::warn!("the keep-awake thread panicked");
        }
    }

    /// The execution state is per thread, so this thread keeps it until told to stop.
    fn hold_awake(only_on_power: bool, stop_receiver: &Receiver<()>) {
        loop {
            let stay_awake = !only_on_power || is_on_ac_power();
            let flags = if stay_awake { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
            // SAFETY: takes flags only and changes this thread's execution state.
            if unsafe { SetThreadExecutionState(flags) } == 0 {
                log::warn!("SetThreadExecutionState failed");
            }
            if !matches!(stop_receiver.recv_timeout(POWER_CHECK_INTERVAL), Err(RecvTimeoutError::Timeout)) {
                break;
            }
        }
        // SAFETY: as above; clears the request before the thread ends.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    }

    /// True on AC power or when Windows cannot tell (`ACLineStatus` 255).
    fn is_on_ac_power() -> bool {
        // SAFETY: SYSTEM_POWER_STATUS is plain data; all zeroes is a valid value.
        let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        // SAFETY: `status` is a valid, writable SYSTEM_POWER_STATUS for the call.
        let succeeded = unsafe { GetSystemPowerStatus(&mut status) } != 0;
        !succeeded || status.ACLineStatus != 0
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
    pub type Handle = ();

    pub fn start(_only_on_power: bool) -> Option<Handle> {
        log::warn!("keeping the computer awake is not supported on this system");
        None
    }

    pub fn stop(_handle: Handle) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_awake_only_with_the_setting_and_a_running_run() {
        let enabled = AppSettings::default();
        let disabled = AppSettings { keep_awake_while_running: false, ..AppSettings::default() };
        assert!(should_keep_awake(&enabled, 1));
        assert!(!should_keep_awake(&enabled, 0));
        assert!(!should_keep_awake(&disabled, 3));
    }

    #[test]
    fn caffeinate_waits_on_graphrt_and_honors_power_source() {
        assert_eq!(caffeinate_arguments(false, 42), ["-i", "-w", "42"]);
        assert_eq!(caffeinate_arguments(true, 42), ["-s", "-w", "42"]);
    }

    #[test]
    fn systemd_inhibit_blocks_sleep_until_graphrt_exits() {
        let arguments = systemd_inhibit_arguments(42);
        assert_eq!(arguments[..2], ["--what=sleep:idle", "--mode=block"]);
        assert_eq!(arguments[4..], ["tail", "--pid=42", "-f", "/dev/null"]);
    }

    fn write_power_supply(root: &std::path::Path, name: &str, kind: &str, online: Option<&str>) {
        let supply_dir = root.join(name);
        std::fs::create_dir_all(&supply_dir).unwrap();
        std::fs::write(supply_dir.join("type"), format!("{kind}\n")).unwrap();
        if let Some(online) = online {
            std::fs::write(supply_dir.join("online"), format!("{online}\n")).unwrap();
        }
    }

    #[test]
    fn reads_mains_power_from_sysfs() {
        let laptop = tempfile::tempdir().unwrap();
        write_power_supply(laptop.path(), "BAT0", "Battery", None);
        write_power_supply(laptop.path(), "AC", "Mains", Some("0"));
        assert_eq!(mains_power_online(laptop.path()), Some(false));
        write_power_supply(laptop.path(), "ADP1", "Mains", Some("1"));
        assert_eq!(mains_power_online(laptop.path()), Some(true));

        let desktop = tempfile::tempdir().unwrap();
        assert_eq!(mains_power_online(desktop.path()), None);
        assert_eq!(mains_power_online(&desktop.path().join("missing")), None);
    }

    #[test]
    fn stopping_without_an_assertion_is_harmless() {
        let keep_awake = KeepAwake::default();
        keep_awake.update(false, true);
        keep_awake.release();
    }
}
