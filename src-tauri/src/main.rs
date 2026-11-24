// Prevents an extra console window on Windows in release builds. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must stay first: it may set GDK_BACKEND, which is only safe while the process is
    // single-threaded and before GTK initialises.
    #[cfg(target_os = "linux")]
    graphrt_lib::linux_display::apply_appimage_wayland_workaround();

    graphrt_lib::run();
}
