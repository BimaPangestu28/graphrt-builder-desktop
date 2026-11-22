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
#   - gh signed in with push rights (GH_TOKEN, or the BimaPangestu28 account)
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
repository="BimaPangestu28/graphrt-builder-desktop"
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

# Fail before a 10-minute build if notarization can't work.
# shellcheck disable=SC2046
xcrun notarytool history $(notary_args) > /dev/null

export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$(cat ~/.tauri/graphrt-updater.key)}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(cat ~/.tauri/graphrt-updater.key.password)}"

if ! $skip_build; then
  pnpm install --frozen-lockfile > /dev/null
  APPLE_SIGNING_IDENTITY="$signing_identity" pnpm tauri build --target aarch64-apple-darwin --bundles app
fi

built_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
[ "$built_version" = "$version" ] || { echo "built app is $built_version, expected $version" >&2; exit 1; }
codesign --verify --deep --strict "$app_path"
"$app_path/Contents/MacOS/graphrt-node" -e 1

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

python3 - "$work_dir" "$version" "$repository" "$notes_file" <<'PY'
import datetime, json, os, sys
work_dir, version, repository, notes_file = sys.argv[1:]
archive = f"graphrt_{version}_aarch64.app.tar.gz"
manifest = {
    "version": version,
    "notes": open(notes_file).read().strip(),
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"darwin-aarch64": {
        "signature": open(os.path.join(work_dir, archive + ".sig")).read().strip(),
        "url": f"https://github.com/{repository}/releases/download/v{version}/{archive}",
    }},
}
json.dump(manifest, open(os.path.join(work_dir, "latest.json"), "w"), indent=2)
PY

dmg_sha="$(shasum -a 256 "$dmg_path" | cut -d' ' -f1)"
archive_sha="$(shasum -a 256 "$updater_archive" | cut -d' ' -f1)"
{
  echo "graphrt Desktop $version for **Apple silicon Macs**, signed with Developer ID and notarized by Apple."
  echo
  cat "$notes_file"
  echo
  echo "Installed apps are offered this update automatically."
  echo
  echo "SHA-256"
  echo "- $(basename "$dmg_path"): $dmg_sha"
  echo "- $(basename "$updater_archive"): $archive_sha"
} > "$work_dir/notes.md"

export GH_TOKEN="${GH_TOKEN:-$(gh auth token -u BimaPangestu28)}"
gh release create "v$version" -R "$repository" --draft --target "$release_commit" --title "graphrt Desktop v$version" \
  --notes-file "$work_dir/notes.md" "$dmg_path" "$updater_archive" "$updater_archive.sig" "$work_dir/latest.json" > /dev/null
if $draft; then
  echo "draft release v$version created"
  exit 0
fi
gh release edit "v$version" -R "$repository" --tag "v$version" --draft=false --latest > /dev/null
sleep 5
published="$(curl -sL "https://github.com/$repository/releases/latest/download/latest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
echo "published v$version; latest.json says $published"
