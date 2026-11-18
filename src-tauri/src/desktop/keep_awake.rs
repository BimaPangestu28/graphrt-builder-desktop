//! "Keep the Mac awake while an agent runs" (macOS only; a no-op elsewhere).
//!
//! While at least one run is `Running` and the setting is on, a child
//! `/usr/bin/caffeinate` process holds a power assertion; it is stopped when
//! the last run ends, the setting is turned off, or the app exits.
//! `caffeinate` is part of macOS, so no dependency is needed, and
//! `-w <graphrt pid>` makes it exit on its own if graphrt dies without
//! stopping it.
//!
//! Flags: `-i` (prevent idle sleep) normally; `-s` (prevent system sleep, which
//! macOS honors only on AC power) when "only while plugged in" is on, so on
//! battery the Mac sleeps as usual.

use std::process::Child;
use std::sync::Mutex;

use super::app_settings::AppSettings;

/// Whether a power assertion should be held right now.
pub fn should_keep_awake(settings: &AppSettings, running_run_count: usize) -> bool {
    settings.keep_awake_while_running && running_run_count > 0
}

/// Arguments of `caffeinate` for the settings, tied to the process `pid`.
pub fn caffeinate_arguments(only_on_power: bool, pid: u32) -> Vec<String> {
    let sleep_flag = if only_on_power { "-s" } else { "-i" };
    vec![sleep_flag.to_owned(), "-w".to_owned(), pid.to_string()]
}

/// The running `caffeinate` child, with the flag it was started with.
#[derive(Debug)]
struct Assertion {
    child: Child,
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
            stop(held);
        }
        if should_be_awake {
            *assertion = start(only_on_power);
        }
    }

    /// Releases the assertion (app exit).
    pub fn release(&self) {
        self.update(false, false);
    }
}

fn stop(mut held: Assertion) {
    if let Err(error) = held.child.kill() {
        log::warn!("could not stop caffeinate: {error}");
    }
    // Reap the child so it does not linger as a zombie.
    let _ = held.child.wait();
    log::info!("the Mac may sleep again");
}

#[cfg(target_os = "macos")]
fn start(only_on_power: bool) -> Option<Assertion> {
    let arguments = caffeinate_arguments(only_on_power, std::process::id());
    match std::process::Command::new("/usr/bin/caffeinate").args(&arguments).spawn() {
        Ok(child) => {
            log::info!("keeping the Mac awake while agents run ({})", arguments.join(" "));
            Some(Assertion { child, only_on_power })
        }
        Err(error) => {
            log::warn!("could not start caffeinate: {error}");
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn start(_only_on_power: bool) -> Option<Assertion> {
    None
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
    fn stopping_without_an_assertion_is_harmless() {
        let keep_awake = KeepAwake::default();
        keep_awake.update(false, true);
        keep_awake.release();
    }
}
