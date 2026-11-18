#!/usr/bin/env bash
# Check that package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json
# carry the same version, and that it matches the release tag when one is given.
#
# Usage: scripts/check-version.sh [vX.Y.Z | X.Y.Z]
# Exits 1 on any mismatch. Requires node (already needed to build the app).
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [vX.Y.Z]" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
expected_version="${1:-}"
expected_version="${expected_version#v}"

read_json_version() {
  node -e 'process.stdout.write(String(require(process.argv[1]).version ?? ""))' "$1"
}

# First `version = "..."` inside the [package] table.
read_cargo_version() {
  awk '
    /^\[/ { in_package = ($0 == "[package]"); next }
    in_package && /^version[[:space:]]*=/ {
      sub(/^version[[:space:]]*=[[:space:]]*"/, ""); sub(/".*$/, ""); print; exit
    }
  ' "$1"
}

package_json_version="$(read_json_version "$repo_root/package.json")"
cargo_toml_version="$(read_cargo_version "$repo_root/src-tauri/Cargo.toml")"
tauri_conf_version="$(read_json_version "$repo_root/src-tauri/tauri.conf.json")"

printf '%-28s %s\n' \
  "package.json" "${package_json_version:-<missing>}" \
  "src-tauri/Cargo.toml" "${cargo_toml_version:-<missing>}" \
  "src-tauri/tauri.conf.json" "${tauri_conf_version:-<missing>}"

reference_version="${expected_version:-$package_json_version}"
mismatch_found=0
for file_version in "$package_json_version" "$cargo_toml_version" "$tauri_conf_version"; do
  if [ -z "$file_version" ] || [ "$file_version" != "$reference_version" ]; then
    mismatch_found=1
  fi
done

if [ "$mismatch_found" -ne 0 ]; then
  if [ -n "$expected_version" ]; then
    echo "error: versions do not all match the tag version $expected_version" >&2
  else
    echo "error: versions differ between files" >&2
  fi
  echo "hint: run scripts/bump-version.sh <x.y.z>" >&2
  exit 1
fi

echo "ok: all versions are $reference_version"
