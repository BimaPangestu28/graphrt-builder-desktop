#!/usr/bin/env bash
# Pin the graphrt CLI release "Put it online" downloads on demand.
#
# Usage: scripts/pin-graphrt-cli.sh <version>      e.g. scripts/pin-graphrt-cli.sh 0.6.0
#
# The app downloads `graphrt-<target>.tar.gz` (`graphrt-x86_64-pc-windows-msvc.zip` on Windows)
# from https://github.com/Graphrt/graphrt/releases/download/v<version>/ and checks it
# against the SHA-256 and size pinned in scripts/graphrt-cli-checksums.txt (compiled into the
# app by src-tauri/build.rs, which refuses a pin that misses a target). This script:
#
#   1. downloads the release's SHA256SUMS (sha256sum format: `<64 hex>  <asset name>`),
#   2. fails unless it lists every target the app downloads for,
#   3. downloads each archive, checks it against SHA256SUMS and measures its size,
#   4. writes scripts/graphrt-cli-checksums.txt and scripts/graphrt-cli-version.
#
# Commit both files. Deploys also need the matching image
# ghcr.io/graphrt/graphrt:<version> (the CLI runs it on Fly.io by default): check it is
# published before pinning a release.
#
# Trust: graphrt releases are not signed; SHA256SUMS comes from GitHub over HTTPS.
#
# Environment (tests): GRAPHRT_RELEASE_BASE_URL replaces
# https://github.com/Graphrt/graphrt/releases/download (the script appends /v<version>/),
# GRAPHRT_PIN_OUTPUT_DIR replaces the scripts/ folder the two files are written to.
set -euo pipefail

readonly TARGET_ASSETS=(
  graphrt-aarch64-apple-darwin.tar.gz
  graphrt-x86_64-apple-darwin.tar.gz
  graphrt-x86_64-unknown-linux-musl.tar.gz
  graphrt-aarch64-unknown-linux-musl.tar.gz
  graphrt-x86_64-pc-windows-msvc.zip
)

fail() {
  echo "pin-graphrt-cli: $*" >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# The 64-hex checksum SHA256SUMS lists for an asset (`<hex>  <name>` or `<hex> *<name>`).
listed_checksum() {
  local sums_file="$1" asset="$2"
  awk -v asset="$asset" '{ name = $2; sub(/^\*/, "", name) } NF == 2 && name == asset { print tolower($1) }' "$sums_file"
}

download() {
  curl --fail --silent --show-error --location --proto '=https,file' --retry 3 --output "$2" "$1" \
    || fail "could not download $1"
}

main() {
  [[ $# -eq 1 ]] || fail "usage: scripts/pin-graphrt-cli.sh <version>"
  local version="${1#v}"
  [[ "$version" =~ ^[0-9A-Za-z.-]+$ && "$version" != "unreleased" ]] || fail "\`$1\` is not a release version such as 0.6.0"

  local script_dir output_dir base_url
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  output_dir="${GRAPHRT_PIN_OUTPUT_DIR:-$script_dir}"
  base_url="${GRAPHRT_RELEASE_BASE_URL:-https://github.com/Graphrt/graphrt/releases/download}/v$version"
  # Global: the EXIT trap runs after main returns.
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT

  download "$base_url/SHA256SUMS" "$work_dir/SHA256SUMS"

  local missing=() asset checksum
  for asset in "${TARGET_ASSETS[@]}"; do
    checksum="$(listed_checksum "$work_dir/SHA256SUMS" "$asset")"
    [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || missing+=("$asset")
  done
  [[ ${#missing[@]} -eq 0 ]] || fail "SHA256SUMS of v$version does not list ${missing[*]}"

  local lines=() actual size
  for asset in "${TARGET_ASSETS[@]}"; do
    checksum="$(listed_checksum "$work_dir/SHA256SUMS" "$asset")"
    download "$base_url/$asset" "$work_dir/$asset"
    actual="$(sha256_of "$work_dir/$asset")"
    [[ "$actual" == "$checksum" ]] || fail "$asset has SHA-256 $actual, SHA256SUMS says $checksum"
    size="$(wc -c <"$work_dir/$asset" | tr -d ' ')"
    lines+=("$checksum  $asset  $size")
    echo "pinned $asset ($size bytes)"
  done

  local checksums_file="$output_dir/graphrt-cli-checksums.txt"
  {
    echo "# graphrt CLI release archives the desktop downloads on demand for \"Put it online\""
    echo "# (src-tauri/build.rs compiles them into the app; see src-tauri/src/deploy/cli_release.rs)."
    echo "#"
    echo "# Written by \`scripts/pin-graphrt-cli.sh $version\` from the SHA256SUMS of"
    echo "# https://github.com/Graphrt/graphrt/releases/tag/v$version; do not edit by hand."
    echo "# One line per release target: \`<sha256>  <asset name>  <size in bytes>\`."
    printf '%s\n' "${lines[@]}"
  } >"$checksums_file.tmp"
  mv "$checksums_file.tmp" "$checksums_file"
  echo "$version" >"$output_dir/graphrt-cli-version"
  echo "wrote $checksums_file and $output_dir/graphrt-cli-version ($version)."
  echo "Check that ghcr.io/graphrt/graphrt:$version is published before shipping this pin."
}

main "$@"
