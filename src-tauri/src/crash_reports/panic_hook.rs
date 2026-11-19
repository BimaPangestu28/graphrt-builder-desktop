//! The process-wide panic hook: writes a crash report, then hands the panic
//! to the previous hook (the default one prints it to stderr).

use std::any::Any;
use std::backtrace::Backtrace;
use std::cell::Cell;
use std::panic::PanicHookInfo;
use std::sync::Arc;

use super::report::PanicDetails;
use super::store::CrashReportStore;

thread_local! {
    /// Set while this thread writes a report, so a panic inside the hook is not reported again.
    static IS_WRITING_REPORT: Cell<bool> = const { Cell::new(false) };
}

/// Installs the hook for the whole process, chaining the hook that was there before.
pub fn install_panic_hook(store: Arc<CrashReportStore>) {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        if !IS_WRITING_REPORT.replace(true) {
            if let Err(error) = store.record_panic(capture_panic_details(panic_info)) {
                // The logger may be what panicked, so write straight to stderr.
                eprintln!("graphrt: could not save a crash report: {error}");
            }
            IS_WRITING_REPORT.set(false);
        }
        previous_hook(panic_info);
    }));
}

fn capture_panic_details(panic_info: &PanicHookInfo<'_>) -> PanicDetails {
    PanicDetails {
        message: panic_message(panic_info.payload()),
        location: panic_info.location().map(|location| location.to_string()),
        thread_name: std::thread::current().name().map(str::to_owned),
        backtrace: Backtrace::force_capture().to_string(),
    }
}

/// The text passed to `panic!` (a `&str` or a `String`), or a placeholder for other payloads.
pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_owned();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "panic with a non-text payload".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_text_payloads() {
        let static_payload: Box<dyn Any + Send> = Box::new("static text");
        let owned_payload: Box<dyn Any + Send> = Box::new(String::from("owned text"));
        let other_payload: Box<dyn Any + Send> = Box::new(42_u8);
        assert_eq!(panic_message(static_payload.as_ref()), "static text");
        assert_eq!(panic_message(owned_payload.as_ref()), "owned text");
        assert_eq!(panic_message(other_payload.as_ref()), "panic with a non-text payload");
    }
}
