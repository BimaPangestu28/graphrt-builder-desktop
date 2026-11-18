#!/usr/bin/env bash
# Print the body of one version section from CHANGELOG.md (without its heading).
#
# Usage: scripts/changelog-section.sh <x.y.z> [changelog-path]
#   A leading "v" is accepted (v0.1.0). Exits 1 if the section is missing or empty.
# Used by .github/workflows/release.yml to fill the GitHub Release body.
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <x.y.z> [changelog-path]" >&2
  exit 2
fi

version="${1#v}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
changelog_path="${2:-$repo_root/CHANGELOG.md}"

if [ ! -f "$changelog_path" ]; then
  echo "error: changelog not found: $changelog_path" >&2
  exit 1
fi

# Section = lines after "## [<version>]" up to the next "## " heading or the
# link reference block ("[x]: https://..."). Leading/trailing blank lines are trimmed.
section_body="$(awk -v heading="## [${version}]" '
  index($0, heading) == 1 { in_section = 1; found = 1; next }
  in_section && (/^## / || /^\[[^]]+\]: /) { exit }
  in_section { lines[++count] = $0 }
  END {
    if (!found) exit 3
    first = 1; while (first <= count && lines[first] ~ /^[[:space:]]*$/) first++
    last = count; while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
    for (i = first; i <= last; i++) print lines[i]
  }
' "$changelog_path")" || {
  echo "error: no \"## [${version}]\" section in $changelog_path" >&2
  exit 1
}

if [ -z "$section_body" ]; then
  echo "error: \"## [${version}]\" section in $changelog_path is empty" >&2
  exit 1
fi

printf '%s\n' "$section_body"
