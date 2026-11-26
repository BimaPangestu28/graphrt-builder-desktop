//! Helpers shared by unit tests across modules (Unix only).

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Writes an executable `#!/bin/sh` script that tests then run (fake CLIs).
///
/// The file is written by a short-lived `sh` child, not by this process: tests run in
/// parallel threads, and a child forked by another test while this process held the
/// file open for writing would keep that handle until its exec, so running the script
/// in that window fails with "Text file busy" (ETXTBSY) on Linux.
pub(crate) fn write_executable_script(path: &Path, body: &str) {
    let mut writer = Command::new("/bin/sh")
        .args(["-c", "cat > \"$1\" && chmod 755 \"$1\"", "write-script"])
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .expect("start sh to write the script");
    writer
        .stdin
        .take()
        .expect("sh stdin")
        .write_all(format!("#!/bin/sh\n{body}\n").as_bytes())
        .expect("send the script to sh");
    let status = writer.wait().expect("wait for sh");
    assert!(status.success(), "could not write {}: {status}", path.display());
}
