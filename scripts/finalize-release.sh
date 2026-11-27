#!/usr/bin/env bash
# Complete a DRAFT release from the bundles attached to it so far: write latest.json (the
# updater manifest), SHA256SUMS and the "Download" notes of each platform. A platform with
# no bundle is named as "not in this release yet". Safe to run again after another platform
# was attached: everything is rebuilt from the files of the release.
#
# Usage: scripts/finalize-release.sh <vX.Y.Z> [--macos-signed]
#   --macos-signed  the macOS bundles on the release were signed and notarized by this run
#
# Run from a checkout of the tag (CHANGELOG.md is read for the updater notes). Needs gh
# (GH_TOKEN with contents: write), python3 and sha256sum. GITHUB_REPOSITORY overrides the
# repository. Refuses to touch a release that is already published.
# Used by .github/workflows/release.yml.
set -euo pipefail

tag="${1:?tag, e.g. v0.2.1}"
shift
macos_signed_flag=()
while [ $# -gt 0 ]; do
  case "$1" in
    --macos-signed) macos_signed_flag=(--macos-signed) ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
repository="${GITHUB_REPOSITORY:-Graphrt/graphrt-builder-desktop}"
version="${tag#v}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
mkdir "$work_dir/assets" "$work_dir/out"

# Drafts are not reachable through /releases/tags/<tag>, so search the list.
release="$(gh api "repos/$repository/releases?per_page=100" \
  --jq ".[] | select(.tag_name == \"$tag\") | \"\(.id) \(.draft)\"" | head -n 1)"
if [ -z "$release" ]; then
  echo "error: no release for $tag in $repository" >&2
  exit 1
fi
read -r release_id is_draft <<<"$release"
if [ "$is_draft" != "true" ]; then
  echo "error: release $tag is already published; refusing to change it" >&2
  exit 1
fi

# Every asset except the two files written below.
gh api --paginate "repos/$repository/releases/$release_id/assets?per_page=100" \
  --jq '.[] | "\(.id)\t\(.name)"' > "$work_dir/asset-list.tsv"
while IFS=$'\t' read -r asset_id asset_name; do
  case "$asset_name" in
    latest.json | SHA256SUMS | "") continue ;;
    */*) echo "error: unexpected asset name $asset_name" >&2; exit 1 ;;
  esac
  gh api -H "Accept: application/octet-stream" \
    "repos/$repository/releases/assets/$asset_id" > "$work_dir/assets/$asset_name"
done < "$work_dir/asset-list.tsv"

"$repo_root/scripts/changelog-section.sh" "$version" > "$work_dir/changelog.md"
python3 "$repo_root/scripts/release-manifest.py" --assets-dir "$work_dir/assets" \
  --version "$version" --repository "$repository" --notes-file "$work_dir/changelog.md" \
  --output-dir "$work_dir/out" ${macos_signed_flag[@]+"${macos_signed_flag[@]}"}

# SHA256SUMS covers every asset of the release except itself, latest.json included.
cp "$work_dir/out/latest.json" "$work_dir/assets/latest.json"
(cd "$work_dir/assets" && sha256sum -- *) > "$work_dir/out/SHA256SUMS"

gh api "repos/$repository/releases/$release_id" --jq .body > "$work_dir/body.md"
for platform in linux windows macos; do
  [ -f "$work_dir/out/$platform.md" ] || continue
  python3 "$repo_root/scripts/merge-release-notes.py" "$work_dir/body.md" \
    "$work_dir/out/$platform.md" > "$work_dir/body.next.md"
  mv "$work_dir/body.next.md" "$work_dir/body.md"
done

gh release upload "$tag" --repo "$repository" --clobber \
  "$work_dir/out/latest.json" "$work_dir/out/SHA256SUMS"
# tag_name is sent on purpose: GitHub renames the tag of a draft to "untagged-..." when a
# draft is updated without it.
gh api -X PATCH "repos/$repository/releases/$release_id" \
  -f tag_name="$tag" -F body=@"$work_dir/body.md" --silent

echo "Draft release $tag now has:"
cat "$work_dir/out/SHA256SUMS"
for platform in linux windows macos; do
  if [ -f "$work_dir/out/$platform.md" ] && grep -q "not in this release yet" "$work_dir/out/$platform.md"; then
    echo "missing: $platform"
  fi
done
