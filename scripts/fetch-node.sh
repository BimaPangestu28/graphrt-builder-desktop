#!/usr/bin/env bash
# Download the Node.js runtime the desktop app ships as a Tauri sidecar.
#
# Usage: scripts/fetch-node.sh [--force] [<target-triple>...]
#
# Targets: aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin
# (both macOS arches plus a lipo'd universal binary), x86_64-pc-windows-msvc,
# x86_64-unknown-linux-gnu. Default: the host's target (from `rustc -vV`).
#
# For each target it downloads the official archive of the version pinned in
# scripts/node-version from nodejs.org, checks it against SHASUMS256.txt and
# places only the `node` executable at src-tauri/binaries/graphrt-node-<triple>[.exe]
# (gitignored). Node's LICENSE (which also carries the notices of the
# libraries Node bundles: V8, OpenSSL, ICU, libuv, ...) is copied to
# src-tauri/licenses/node-LICENSE.txt, which the app bundle ships.
#
# Trust: SHASUMS256.txt comes from nodejs.org over HTTPS. When gpg is
# installed its clearsigned SHASUMS256.txt.asc is verified against the Node.js
# release keys pinned below by fingerprint (key material from the
# nodejs/release-keys repository); a bad signature always fails. Without gpg
# the script warns and relies on HTTPS + SHA-256 only, unless
# GRAPHRT_REQUIRE_NODE_SIGNATURE=1 (set in CI), which makes gpg mandatory.
#
# Already-fetched binaries of the pinned version are kept (a stamp file records
# the version and archive checksum); --force downloads again.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
node_version="$(tr -d '[:space:]' < "$repo_root/scripts/node-version")"
binaries_dir="$repo_root/src-tauri/binaries"
license_file="$repo_root/src-tauri/licenses/node-LICENSE.txt"
dist_url="https://nodejs.org/dist/v$node_version"
release_keys_url="https://raw.githubusercontent.com/nodejs/release-keys/HEAD/keys"

# Active Node.js releasers (https://github.com/nodejs/node#release-keys).
# Update this list when the release team changes.
release_key_fingerprints=(
  5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 # Antoine du Hamel
  C0D6248439F1D5604AAFFB4021D900FFDB233756 # Antoine du Hamel (previous key)
  DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7 # Juan José Arboleda
  CC68F5A3106FF448322E48ED27F5E38D5B0A215F # Marco Ippolito
  8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 # Michaël Zasso
  890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4 # Rafael Gonzaga
  C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C # Richard Lau
  108F52B48DB57BB0CC439B2997B01419BD92F80A # Ruy Adorno
  A363A499291CBBC940DD62E41F10027AF002F8B0 # Ulises Gascón
  655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD # Node.js release team
)

force_download=false
targets=()
for argument in "$@"; do
  case "$argument" in
    --force) force_download=true ;;
    -h | --help)
      sed -n '2,26p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown option: $argument" >&2
      exit 2
      ;;
    *) targets+=("$argument") ;;
  esac
done

fail() {
  echo "fetch-node: $*" >&2
  exit 1
}

host_target_triple() {
  command -v rustc > /dev/null || fail "rustc not found; pass the target triple explicitly"
  rustc -vV | sed -n 's/^host: //p'
}

if [ "${#targets[@]}" -eq 0 ]; then
  targets=("$(host_target_triple)")
fi

# Node's platform name and archive for a target triple.
node_platform_for() {
  case "$1" in
    aarch64-apple-darwin) echo "darwin-arm64" ;;
    x86_64-apple-darwin) echo "darwin-x64" ;;
    x86_64-pc-windows-msvc) echo "win-x64" ;;
    x86_64-unknown-linux-gnu) echo "linux-x64" ;;
    *) fail "unsupported target triple: $1" ;;
  esac
}

archive_name_for() {
  local platform="$1"
  case "$platform" in
    win-*) echo "node-v$node_version-$platform.zip" ;;
    *) echo "node-v$node_version-$platform.tar.xz" ;;
  esac
}

sidecar_path_for() {
  case "$1" in
    *-windows-*) echo "$binaries_dir/graphrt-node-$1.exe" ;;
    *) echo "$binaries_dir/graphrt-node-$1" ;;
  esac
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

download() {
  curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 -o "$2" "$1"
}

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

shasums_file="$work_dir/SHASUMS256.txt"
fetch_verified_shasums() {
  if [ -s "$shasums_file" ]; then
    return
  fi
  download "$dist_url/SHASUMS256.txt" "$shasums_file"
  if ! command -v gpg > /dev/null; then
    if [ "${GRAPHRT_REQUIRE_NODE_SIGNATURE:-0}" = "1" ]; then
      fail "gpg is required (GRAPHRT_REQUIRE_NODE_SIGNATURE=1) to verify SHASUMS256.txt"
    fi
    echo "fetch-node: warning: gpg not found; trusting SHASUMS256.txt from HTTPS without checking its signature" >&2
    return
  fi
  verify_shasums_signature
}

verify_shasums_signature() {
  local gnupg_home="$work_dir/gnupg"
  local signed_file="$work_dir/SHASUMS256.txt.asc"
  local status_file="$work_dir/gpg-status"
  mkdir -m 700 "$gnupg_home"
  download "$dist_url/SHASUMS256.txt.asc" "$signed_file"
  local fingerprint
  for fingerprint in "${release_key_fingerprints[@]}"; do
    # A key that fails to download is skipped; the signer must still be pinned.
    if download "$release_keys_url/$fingerprint.asc" "$work_dir/key.asc" 2> /dev/null; then
      gpg --homedir "$gnupg_home" --batch --quiet --import "$work_dir/key.asc" 2> /dev/null || true
    fi
  done
  if ! gpg --homedir "$gnupg_home" --batch --status-fd 3 --output "$work_dir/SHASUMS256.signed.txt" \
    --decrypt "$signed_file" 3> "$status_file" 2> /dev/null; then
    fail "the signature of SHASUMS256.txt for Node v$node_version does not verify"
  fi
  # VALIDSIG's last field is the primary key fingerprint; it must be pinned.
  local signer
  signer="$(awk '$2 == "VALIDSIG" { print $NF }' "$status_file")"
  [ -n "$signer" ] || fail "no valid signature on SHASUMS256.txt"
  local pinned=false
  for fingerprint in "${release_key_fingerprints[@]}"; do
    [ "$fingerprint" = "$signer" ] && pinned=true
  done
  $pinned || fail "SHASUMS256.txt is signed by $signer, which is not a pinned Node.js release key"
  # Use the signed content, not the separately downloaded copy.
  cp "$work_dir/SHASUMS256.signed.txt" "$shasums_file"
  echo "fetch-node: SHASUMS256.txt signature OK (key $signer)"
}

expected_sha256_for() {
  local archive_name="$1"
  awk -v name="$archive_name" '$2 == name { print $1 }' "$shasums_file"
}

# Extracts one file from the archive (paths inside start with the archive's base name).
extract_member() {
  local archive="$1" member="$2" destination="$3"
  local extract_dir="$work_dir/extract"
  rm -rf "$extract_dir" && mkdir -p "$extract_dir"
  case "$archive" in
    *.zip)
      if command -v unzip > /dev/null; then
        unzip -q -o "$archive" "$member" -d "$extract_dir"
      elif command -v powershell.exe > /dev/null; then
        # Git Bash / MSYS paths (/tmp/...) mean nothing to PowerShell; convert them.
        local windows_archive="$archive" windows_extract_dir="$extract_dir"
        if command -v cygpath > /dev/null; then
          windows_archive="$(cygpath -w "$archive")"
          windows_extract_dir="$(cygpath -w "$extract_dir")"
        fi
        powershell.exe -NoProfile -NonInteractive -Command \
          "Expand-Archive -Force -LiteralPath '$windows_archive' -DestinationPath '$windows_extract_dir'"
      else
        fail "unzip or PowerShell is needed to extract $(basename "$archive")"
      fi
      ;;
    *) tar -xJf "$archive" -C "$extract_dir" "$member" ;;
  esac
  [ -f "$extract_dir/$member" ] || fail "$member not found in $(basename "$archive")"
  mv "$extract_dir/$member" "$destination"
}

fetch_target() {
  local target="$1"
  local platform archive_name sidecar stamp expected_sha256 archive actual_sha256 base_name executable_member
  platform="$(node_platform_for "$target")"
  archive_name="$(archive_name_for "$platform")"
  sidecar="$(sidecar_path_for "$target")"
  stamp="$sidecar.stamp"

  fetch_verified_shasums
  expected_sha256="$(expected_sha256_for "$archive_name")"
  [ -n "$expected_sha256" ] || fail "$archive_name is not listed in SHASUMS256.txt"

  if ! $force_download && [ -s "$sidecar" ] && [ "$(cat "$stamp" 2> /dev/null)" = "$node_version $expected_sha256" ]; then
    echo "fetch-node: $target already has Node v$node_version ($sidecar)"
    return
  fi

  echo "fetch-node: downloading $archive_name"
  archive="$work_dir/$archive_name"
  download "$dist_url/$archive_name" "$archive"
  actual_sha256="$(sha256_of "$archive")"
  [ "$actual_sha256" = "$expected_sha256" ] || fail "checksum mismatch for $archive_name: expected $expected_sha256, got $actual_sha256"

  base_name="node-v$node_version-$platform"
  case "$platform" in
    win-*) executable_member="$base_name/node.exe" ;;
    *) executable_member="$base_name/bin/node" ;;
  esac
  mkdir -p "$binaries_dir" "$(dirname "$license_file")"
  extract_member "$archive" "$executable_member" "$sidecar.partial"
  chmod 755 "$sidecar.partial"
  # Archives keep the release date as mtime; cargo's rerun-if-changed needs a fresh one.
  touch "$sidecar.partial"
  mv "$sidecar.partial" "$sidecar"
  extract_member "$archive" "$base_name/LICENSE" "$work_dir/LICENSE"
  if ! cmp -s "$work_dir/LICENSE" "$license_file"; then
    cp "$work_dir/LICENSE" "$license_file"
    echo "fetch-node: updated $license_file (commit it with the version bump)"
  fi
  echo "$node_version $expected_sha256" > "$stamp"
  echo "fetch-node: $target -> $sidecar"
}

# Tauri looks for `<name>-universal-apple-darwin` when bundling a universal app,
# while each per-arch cargo build copies its own `<name>-<arch>-apple-darwin`.
fetch_universal_macos() {
  fetch_target aarch64-apple-darwin
  fetch_target x86_64-apple-darwin
  command -v lipo > /dev/null || fail "lipo (Xcode command line tools) is needed for universal-apple-darwin"
  local universal="$binaries_dir/graphrt-node-universal-apple-darwin"
  lipo -create -output "$universal.partial" \
    "$binaries_dir/graphrt-node-aarch64-apple-darwin" "$binaries_dir/graphrt-node-x86_64-apple-darwin"
  chmod 755 "$universal.partial"
  mv "$universal.partial" "$universal"
  echo "fetch-node: universal-apple-darwin -> $universal"
}

for target in "${targets[@]}"; do
  case "$target" in
    universal-apple-darwin) fetch_universal_macos ;;
    *) fetch_target "$target" ;;
  esac
done
