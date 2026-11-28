#!/usr/bin/env bash
# Builds (optionally), signs, notarizes, staples and publishes a macOS (Apple silicon) release
# from this Mac, for when GitHub Actions can't. Mirrors .github/workflows/release.yml for one
# target. Nothing secret is stored here: keys and credentials are read from where they live.
#
# Usage:
#   scripts/release-macos-local.sh <version> <notes.md> [--skip-build] [--commit <sha>] [--draft]
#
# Needs:
#   - "Developer ID Application" identity in the login keychain (DEVELOPER_ID overrides the name)
#   - notarization credentials, either an App Store Connect API key
#       (NOTARY_KEY=<path to AuthKey_XXXX.p8> NOTARY_KEY_ID=<key id> NOTARY_ISSUER=<issuer uuid>)
#     or a notarytool keychain profile (NOTARY_PROFILE, default "graphrt-notary")
#   - the updater signing key: TAURI_SIGNING_PRIVATE_KEY(_PASSWORD), else ~/.tauri/graphrt-updater.key(.password)
#   - GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET for Google Cloud sign in (CONTRIBUTING.md; a build
#     without it says signing in to Google Cloud is not available)
#   - gh signed in with push rights (GH_TOKEN, or the BimaPangestu28 account)
#
# If release v<version> already exists (e.g. the Linux build was published first), the macOS
# assets are added to it: darwin-aarch64 is merged into its latest.json (other platforms kept),
# SHA256SUMS is rewritten over every asset and the macOS block of the notes is replaced. A
# published release stays published; <notes.md> is then only used if it has no latest.json.
set -euo pipefail

version="${1:?version, e.g. 0.1.4}"
notes_file="${2:?release notes markdown file}"
shift 2
skip_build=false draft=false release_commit=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) skip_build=true ;;
    --draft) draft=true ;;
    --commit) release_commit="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
repository="Graphrt/graphrt-builder-desktop"
signing_identity="${DEVELOPER_ID:-Developer ID Application: Bima Pangestu (5Z53R3J88D)}"
bundle_dir="src-tauri/target/aarch64-apple-darwin/release/bundle"
app_path="$bundle_dir/macos/graphrt.app"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
release_commit="${release_commit:-$(git rev-parse HEAD)}"

notary_args() {
  if [ -n "${NOTARY_KEY:-}" ]; then
    echo "--key $NOTARY_KEY --key-id ${NOTARY_KEY_ID:?} --issuer ${NOTARY_ISSUER:?}"
  else
    echo "--keychain-profile ${NOTARY_PROFILE:-graphrt-notary}"
  fi
}

# Submits $1 to Apple and staples the ticket onto $2 (the app inside a zip, or the dmg itself).
notarize_and_staple() {
  local submission="$1" staple_target="$2" status
  # shellcheck disable=SC2046 # notary_args is a list of flags
  status="$(xcrun notarytool submit "$submission" $(notary_args) --wait --timeout 60m | grep -E "status:" | tail -1)"
  case "$status" in
    *Accepted*) ;;
    *) echo "notarization of $(basename "$submission") was not accepted: ${status:-no status}" >&2; exit 1 ;;
  esac
  xcrun stapler staple "$staple_target"
  echo "notarized and stapled $(basename "$staple_target")"
}

# A tag that already exists (the Linux build may have been released first) must be the commit
# being built, or the Mac app would not match the rest of the release.
remote_tag="$(git ls-remote --tags origin "refs/tags/v$version" "refs/tags/v$version^{}" | sort -k2 | tail -1 | cut -f1)"
if [ -n "$remote_tag" ] && [ "$remote_tag" != "$release_commit" ]; then
  echo "tag v$version is $remote_tag but this build is $release_commit: git checkout v$version first" >&2
  exit 1
fi

# Fail before a 10-minute build if notarization can't work.
# shellcheck disable=SC2046
xcrun notarytool history $(notary_args) > /dev/null

export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$(cat ~/.tauri/graphrt-updater.key)}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(cat ~/.tauri/graphrt-updater.key.password)}"

if ! $skip_build; then
  [ -n "${GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET:-}" ] || echo "warning: GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET is not set: this build cannot sign in to Google Cloud" >&2
  pnpm install --frozen-lockfile > /dev/null
  APPLE_SIGNING_IDENTITY="$signing_identity" pnpm tauri build --target aarch64-apple-darwin --bundles app
fi

built_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
[ "$built_version" = "$version" ] || { echo "built app is $built_version, expected $version" >&2; exit 1; }
codesign --verify --deep --strict "$app_path"
# Node.js is downloaded on demand, never bundled: a stray sidecar would add ~110 MB.
if [ -e "$app_path/Contents/MacOS/graphrt-node" ]; then
  echo "the app bundles graphrt-node; release builds must not (see scripts/fetch-node.sh)" >&2
  exit 1
fi

ditto -c -k --keepParent "$app_path" "$work_dir/graphrt.zip"
notarize_and_staple "$work_dir/graphrt.zip" "$app_path"

# The updater bundle is made from the stapled app, then signed bound to this version.
updater_archive="$work_dir/graphrt_${version}_aarch64.app.tar.gz"
(cd "$bundle_dir/macos" && COPYFILE_DISABLE=1 tar -czf "$updater_archive" graphrt.app)
pnpm -s tauri signer sign --app-version "$version" "$updater_archive" > /dev/null

dmg_path="$work_dir/graphrt_${version}_aarch64.dmg"
mkdir "$work_dir/dmg"
ditto "$app_path" "$work_dir/dmg/graphrt.app"
ln -s /Applications "$work_dir/dmg/Applications"
hdiutil create -volname graphrt -srcfolder "$work_dir/dmg" -ov -format UDZO "$dmg_path" > /dev/null
codesign --force --sign "$signing_identity" --timestamp "$dmg_path"
notarize_and_staple "$dmg_path" "$dmg_path"
spctl -a -t open --context context:primary-signature "$dmg_path"

# The release may already exist with other platforms on it (Linux is built and uploaded on
# another machine). Then its latest.json gets darwin-aarch64 added and keeps the others,
# SHA256SUMS is rewritten over all assets and the macOS block of its notes is replaced.
export GH_TOKEN="${GH_TOKEN:-$(gh auth token -u BimaPangestu28)}"
release_exists=false
existing_manifest_args=()
mkdir "$work_dir/existing"
if gh release view "v$version" -R "$repository" > /dev/null 2>&1; then
  release_exists=true
  if gh release view "v$version" -R "$repository" --json assets -q '.assets[].name' | grep -qx latest.json; then
    gh release download "v$version" -R "$repository" -p latest.json -D "$work_dir/existing"
    existing_manifest_args=(--existing "$work_dir/existing/latest.json")
  fi
fi
python3 "$repo_root/scripts/merge-updater-manifest.py" --version "$version" --platform darwin-aarch64 \
  --signature-file "$updater_archive.sig" \
  --url "https://github.com/$repository/releases/download/v$version/$(basename "$updater_archive")" \
  --notes-file "$notes_file" --output "$work_dir/latest.json" ${existing_manifest_args[@]+"${existing_manifest_args[@]}"}

dmg_sha="$(shasum -a 256 "$dmg_path" | cut -d' ' -f1)"
archive_sha="$(shasum -a 256 "$updater_archive" | cut -d' ' -f1)"
{
  echo "<!-- macos:start -->"
  echo "**Apple silicon Macs**: signed with Developer ID and notarized by Apple."
  echo
  echo "SHA-256"
  echo "- $(basename "$dmg_path"): $dmg_sha"
  echo "- $(basename "$updater_archive"): $archive_sha"
  echo "<!-- macos:end -->"
} > "$work_dir/macos-notes.md"

# SHA256SUMS covers every asset of the release except itself, latest.json included.
sums_dir="$work_dir/sums"
mkdir "$sums_dir"
if $release_exists; then
  gh release download "v$version" -R "$repository" -D "$sums_dir"
fi
cp "$dmg_path" "$updater_archive" "$updater_archive.sig" "$work_dir/latest.json" "$sums_dir/"
rm -f "$sums_dir/SHA256SUMS"
(cd "$sums_dir" && for asset in *; do shasum -a 256 "$asset"; done) > "$work_dir/SHA256SUMS"

if $release_exists; then
  gh release view "v$version" -R "$repository" --json body -q .body > "$work_dir/existing/body.md"
  python3 "$repo_root/scripts/merge-release-notes.py" "$work_dir/existing/body.md" \
    "$work_dir/macos-notes.md" > "$work_dir/notes.md"
  gh release upload "v$version" -R "$repository" --clobber "$dmg_path" "$updater_archive" \
    "$updater_archive.sig" "$work_dir/latest.json" "$work_dir/SHA256SUMS" > /dev/null
  gh release edit "v$version" -R "$repository" --notes-file "$work_dir/notes.md" > /dev/null
  echo "added the macOS build to the existing release v$version"
else
  # Release body: "What's new" (the notes file, short plain bullets), then "Download" with
  # one block per platform between <!-- name:start/end --> markers.
  {
    echo "## What's new"
    echo
    cat "$notes_file"
    echo
    echo "Installed apps are offered this update automatically."
    echo
    echo "## Download"
    echo
    cat "$work_dir/macos-notes.md"
  } > "$work_dir/notes.md"
  gh release create "v$version" -R "$repository" --draft --target "$release_commit" --title "Graphrt Desktop $version" \
    --notes-file "$work_dir/notes.md" "$dmg_path" "$updater_archive" "$updater_archive.sig" \
    "$work_dir/latest.json" "$work_dir/SHA256SUMS" > /dev/null
fi

if [ "$(gh release view "v$version" -R "$repository" --json isDraft -q .isDraft)" = false ]; then
  echo "release v$version is already published"
elif $draft; then
  echo "release v$version is a draft"
  exit 0
else
  gh release edit "v$version" -R "$repository" --tag "v$version" --draft=false --latest > /dev/null
  echo "published v$version"
fi
sleep 5
published="$(curl -sL "https://github.com/$repository/releases/latest/download/latest.json" \
  | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["version"], "with", ", ".join(m["platforms"]))')"
echo "latest.json says $published"
