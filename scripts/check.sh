#!/usr/bin/env bash
# Run the checks CI runs on Linux for a pull request (.github/workflows/ci.yml), in the
# same order. Run it before every push: a red CI run costs about ten minutes.
#
# Usage: scripts/check.sh [--bundle]
#   --bundle   also verify the pinned Node.js checksums and compile the release app
#              (`pnpm tauri build --no-bundle`), like the "desktop bundle" job. Slow, and
#              the checksum step needs the network and gpg.
# Stops at the first check that fails and exits with its status.
# Requires node 22+, pnpm 10+ and a stable Rust toolchain with rustfmt and clippy.
# Keep the steps equal to the `version`, `frontend`, `rust` and `bundle` jobs of ci.yml.
set -euo pipefail

with_bundle=0
for argument in "$@"; do
  case "$argument" in
    --bundle) with_bundle=1 ;;
    -h | --help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "usage: $0 [--bundle]" >&2
      exit 2
      ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

for tool in node pnpm cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is not installed or not on PATH (see CONTRIBUTING.md, Setup)" >&2
    exit 1
  fi
done

cargo_manifest="src-tauri/Cargo.toml"

run_step() {
  printf '\n==> %s\n' "$*"
  "$@"
}

# version
run_step scripts/check-version.sh

# frontend
run_step pnpm install --frozen-lockfile
run_step pnpm typecheck
run_step pnpm test
# tauri::generate_context! embeds dist/ at compile time, so clippy needs this build.
run_step pnpm build

# rust
run_step cargo fmt --manifest-path "$cargo_manifest" --all -- --check
run_step cargo clippy --manifest-path "$cargo_manifest" --all-targets -- -D warnings
run_step cargo test --manifest-path "$cargo_manifest"

# bundle
if [ "$with_bundle" -eq 1 ]; then
  run_step env GRAPHRT_REQUIRE_NODE_SIGNATURE=1 scripts/fetch-node.sh --verify-checksums
  run_step pnpm tauri build --no-bundle
fi

printf '\nAll checks passed.\n'
