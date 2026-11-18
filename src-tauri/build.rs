//! Build script: Tauri codegen plus a guard for the Node.js sidecar.
//!
//! `bundle.externalBin` lists `binaries/graphrt-node`, which `scripts/fetch-node.sh`
//! downloads (it is not committed). tauri-build refuses to build when a sidecar
//! is missing, which would make `cargo test` / `cargo clippy` need the network.
//! So for debug builds without the sidecar this script drops `externalBin` from
//! the configuration (through `TAURI_CONFIG`, which tauri-build merges) and
//! warns; the app then falls back to a `node` on PATH. Release builds fail with
//! a message pointing at the script. `tauri dev` / `tauri build` are checked
//! earlier by `scripts/check-node-sidecar.mjs`.

use std::path::Path;

fn main() {
    if let Err(message) = prepare_node_sidecar() {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
    tauri_build::build()
}

fn prepare_node_sidecar() -> Result<(), String> {
    let target_triple = std::env::var("TARGET").map_err(|error| format!("TARGET is not set: {error}"))?;
    let extension = if target_triple.contains("windows") { ".exe" } else { "" };
    let sidecar = Path::new("binaries").join(format!("graphrt-node-{target_triple}{extension}"));
    // Re-run once the sidecar is fetched (the directory changes when it appears).
    println!("cargo:rerun-if-changed=binaries");
    println!("cargo:rerun-if-changed={}", sidecar.display());
    let present = std::fs::metadata(&sidecar).map(|metadata| metadata.is_file() && metadata.len() > 0).unwrap_or(false);
    if present {
        return Ok(());
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        return Err(format!(
            "the Node.js sidecar {} is missing; run `scripts/fetch-node.sh {target_triple}` first",
            sidecar.display()
        ));
    }
    println!(
        "cargo:warning=Node.js sidecar {} not found: building without it (debug only); \
         run `scripts/fetch-node.sh {target_triple}` to bundle Node",
        sidecar.display()
    );
    // The Tauri CLI sets TAURI_CONFIG itself; leave its merged config alone.
    if std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":null}}"#);
    }
    Ok(())
}
