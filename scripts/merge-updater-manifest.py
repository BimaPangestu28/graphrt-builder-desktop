#!/usr/bin/env python3
"""Write the updater manifest (latest.json) for one platform of a release.

Releases are built one platform at a time on different machines (Linux in Docker, macOS on
a Mac), so a platform is added to the latest.json the release already has instead of
replacing it: the other platforms' entries are kept. Without an existing manifest a new one
is written. The existing manifest must be for the same version.

Usage:
  scripts/merge-updater-manifest.py --version 0.1.7 --platform darwin-aarch64 \
      --signature-file graphrt_0.1.7_aarch64.app.tar.gz.sig \
      --url https://github.com/<repo>/releases/download/v0.1.7/graphrt_0.1.7_aarch64.app.tar.gz \
      --notes-file notes.md --output latest.json [--existing previous-latest.json]

The notes of an existing manifest are kept; --notes-file is used only for a new one.
Standard library only (runs on the macOS system python3).
"""

import argparse
import datetime
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--version", required=True)
    parser.add_argument(
        "--platform", required=True, help="e.g. darwin-aarch64, linux-x86_64"
    )
    parser.add_argument("--signature-file", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--notes-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--existing", help="the release's current latest.json, if it has one"
    )
    args = parser.parse_args()

    with open(args.signature_file, encoding="utf-8") as signature_file:
        signature = signature_file.read().strip()
    if not signature:
        print(f"error: {args.signature_file} is empty", file=sys.stderr)
        return 1

    if args.existing:
        with open(args.existing, encoding="utf-8") as existing_file:
            manifest = json.load(existing_file)
        if manifest.get("version") != args.version:
            print(
                f"error: the release's latest.json is for {manifest.get('version')!r}, "
                f"not {args.version!r}",
                file=sys.stderr,
            )
            return 1
        if not isinstance(manifest.get("platforms"), dict):
            print(
                "error: the release's latest.json has no platforms object",
                file=sys.stderr,
            )
            return 1
        if not manifest.get("notes"):
            with open(args.notes_file, encoding="utf-8") as notes_file:
                manifest["notes"] = notes_file.read().strip()
    else:
        with open(args.notes_file, encoding="utf-8") as notes_file:
            manifest = {
                "version": args.version,
                "notes": notes_file.read().strip(),
                "platforms": {},
            }

    manifest["pub_date"] = datetime.datetime.now(datetime.timezone.utc).strftime(  # noqa: UP017 (macOS python3 is 3.9)
        "%Y-%m-%dT%H:%M:%SZ"
    )
    manifest["platforms"][args.platform] = {"signature": signature, "url": args.url}
    ordered = {
        "version": manifest["version"],
        "notes": manifest["notes"],
        "pub_date": manifest["pub_date"],
        "platforms": dict(sorted(manifest["platforms"].items())),
    }
    with open(args.output, "w", encoding="utf-8") as output_file:
        json.dump(ordered, output_file, indent=2, ensure_ascii=False)
        output_file.write("\n")
    print(f"latest.json {args.version}: {', '.join(ordered['platforms'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
