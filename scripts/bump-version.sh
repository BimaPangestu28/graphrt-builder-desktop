#!/usr/bin/env bash
# The node and awk programs below are single-quoted on purpose: $ belongs to them.
# shellcheck disable=SC2016
# Set the app version in package.json, src-tauri/tauri.conf.json,
# src-tauri/Cargo.toml and the graphrt entry of src-tauri/Cargo.lock.
#
# Usage: scripts/bump-version.sh <x.y.z>
# Only the version lines change; formatting is preserved. Requires node.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <x.y.z>" >&2
  exit 2
fi

new_version="${1#v}"
semver_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
if ! printf '%s' "$new_version" | grep -Eq "$semver_pattern"; then
  echo "error: \"$1\" is not a semantic version (x.y.z)" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
crate_name="graphrt"

# Replace the top-level "version": "..." of a 2-space-indented JSON file, keeping formatting.
set_json_version() {
  node -e '
    const fs = require("fs");
    const [file, version] = process.argv.slice(1);
    const original = fs.readFileSync(file, "utf8");
    const pattern = /^(  "version":\s*")[^"]*(")/m;
    if (!pattern.test(original)) {
      console.error(`error: no top-level "version" in ${file}`);
      process.exit(1);
    }
    fs.writeFileSync(file, original.replace(pattern, `$1${version}$2`));
  ' "$1" "$new_version"
}

# Rewrite a file through an awk program; fail if awk did not find its target.
rewrite_with_awk() {
  local target_file="$1" awk_program="$2" temporary_file
  temporary_file="$(mktemp)"
  if ! awk -v version="$new_version" -v crate="$crate_name" "$awk_program" "$target_file" >"$temporary_file"; then
    rm -f "$temporary_file"
    echo "error: could not update version in $target_file" >&2
    exit 1
  fi
  cat "$temporary_file" >"$target_file"
  rm -f "$temporary_file"
}

cargo_toml_program='
  /^\[/ { in_package = ($0 == "[package]") }
  in_package && !done && /^version[[:space:]]*=/ { $0 = "version = \"" version "\""; done = 1 }
  { print }
  END { if (!done) exit 1 }
'
# In Cargo.lock this crate is `name = "graphrt"` immediately followed by its version line.
cargo_lock_program='
  $0 == "name = \"" crate "\"" { pending = 1; print; next }
  pending && /^version = / { $0 = "version = \"" version "\""; done = 1 }
  { pending = 0; print }
  END { if (!done) exit 1 }
'

set_json_version "$repo_root/package.json"
set_json_version "$repo_root/src-tauri/tauri.conf.json"
rewrite_with_awk "$repo_root/src-tauri/Cargo.toml" "$cargo_toml_program"
rewrite_with_awk "$repo_root/src-tauri/Cargo.lock" "$cargo_lock_program"

"$repo_root/scripts/check-version.sh" "$new_version"
echo "next: move the Unreleased notes in CHANGELOG.md under \"## [$new_version] - $(date +%Y-%m-%d)\""
