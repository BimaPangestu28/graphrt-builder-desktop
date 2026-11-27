#!/usr/bin/env bash
# Copy graphrt's monitoring page into the app (Settings > Phone access serves it to phones).
#
# Usage: scripts/sync-monitor-assets.sh [--check]
#   --check   only compare: exit 1 when a file differs from the pinned graphrt revision
#
# The page is built in graphrt (web/packages/monitor) and committed there under
# crates/graphrt-cli/assets/monitor. This script downloads those files at the graphrt revision
# src-tauri/Cargo.toml pins (`rev = "..."` of the graphrt crates) into src-tauri/assets/monitor.
# Run it after moving the pin, and commit the result together with the new pin.
#
# Environment (tests): GRAPHRT_RAW_BASE_URL replaces https://raw.githubusercontent.com/Graphrt/graphrt.
set -euo pipefail

check_only=0
case "${1:-}" in
  --check) check_only=1 ;;
  "") ;;
  -h | --help)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target_dir="$repo_root/src-tauri/assets/monitor"
readonly files=(index.html monitor.js sw.js manifest.webmanifest icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png)

rev="$(grep -o 'graphrt-core = { git = "https://github.com/Graphrt/graphrt", rev = "[0-9a-f]\{40\}"' "$repo_root/src-tauri/Cargo.toml" | grep -o '[0-9a-f]\{40\}')"
if [ -z "$rev" ]; then
  echo "sync-monitor-assets: cannot read the graphrt revision from src-tauri/Cargo.toml" >&2
  exit 1
fi
base_url="${GRAPHRT_RAW_BASE_URL:-https://raw.githubusercontent.com/Graphrt/graphrt}/$rev/crates/graphrt-cli/assets/monitor"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

differs=0
for file in "${files[@]}"; do
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$base_url/$file" -o "$work_dir/$file"
  if ! cmp -s "$work_dir/$file" "$target_dir/$file"; then
    differs=1
    echo "differs: $file"
  fi
done

if [ "$check_only" -eq 1 ]; then
  if [ "$differs" -eq 1 ]; then
    echo "sync-monitor-assets: src-tauri/assets/monitor is not graphrt $rev: run scripts/sync-monitor-assets.sh" >&2
    exit 1
  fi
  echo "src-tauri/assets/monitor matches graphrt $rev"
  exit 0
fi

mkdir -p "$target_dir"
for file in "${files[@]}"; do
  cp "$work_dir/$file" "$target_dir/$file"
done
echo "copied the monitoring page of graphrt $rev into src-tauri/assets/monitor"
