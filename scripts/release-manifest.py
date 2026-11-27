#!/usr/bin/env python3
"""Write latest.json and the per-platform release notes from the files of one release.

Usage:
  scripts/release-manifest.py --assets-dir <dir> --version 0.2.1 \
      --repository Graphrt/graphrt-builder-desktop --notes-file notes.md \
      --output-dir <dir> [--macos-signed]

<assets-dir> holds every asset of the release (bundles and their .sig files). Written to
<output-dir>:
  latest.json   the updater manifest, built from the .sig files that are there
  linux.md, windows.md, macos.md
                one "Download" block per platform, wrapped in <!-- name:start/end --> for
                scripts/merge-release-notes.py. A platform with no bundle gets a block that
                says so. macos.md is left out when macOS bundles are there but were not
                attached by this run (--macos-signed absent): whoever attached them, e.g.
                scripts/release-macos-local.sh, wrote their own block.

The manifest is rebuilt from scratch on every run, so the order in which platforms are
attached does not matter and a platform that failed can be added later.
Standard library only.
"""

import argparse
import datetime
import hashlib
import json
import os
import sys

# Bundle file name ending -> updater platform keys (the same keys tauri-action writes:
# "<os>-<arch>" is what an installed app asks for first by its own bundle type, e.g.
# "linux-x86_64-deb", then without it). The first rule that matches a key wins, so the
# AppImage and the NSIS installer are the default for their OS, and a per-architecture
# macOS archive is preferred over the universal one.
UPDATER_RULES = [
    ("_amd64.AppImage", ["linux-x86_64", "linux-x86_64-appimage"]),
    ("_aarch64.AppImage", ["linux-aarch64", "linux-aarch64-appimage"]),
    ("_amd64.deb", ["linux-x86_64-deb"]),
    ("_arm64.deb", ["linux-aarch64-deb"]),
    (".x86_64.rpm", ["linux-x86_64-rpm"]),
    (".aarch64.rpm", ["linux-aarch64-rpm"]),
    ("_x64-setup.exe", ["windows-x86_64", "windows-x86_64-nsis"]),
    ("_x64_en-US.msi", ["windows-x86_64-msi"]),
    ("_aarch64.app.tar.gz", ["darwin-aarch64", "darwin-aarch64-app"]),
    ("_x64.app.tar.gz", ["darwin-x86_64", "darwin-x86_64-app"]),
    (
        "_universal.app.tar.gz",
        ["darwin-aarch64", "darwin-aarch64-app", "darwin-x86_64", "darwin-x86_64-app"],
    ),
]

NOT_INCLUDED = "not in this release yet."


class ReleaseError(Exception):
    """The release files cannot be turned into a manifest."""


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(
    asset_names: list[str],
    signatures: dict[str, str],
    version: str,
    repository: str,
    notes: str,
    pub_date: str,
) -> dict:
    """Updater manifest for the signed bundles in asset_names.

    signatures maps a bundle name to the content of its .sig file.
    """
    names = set(asset_names)
    missing = sorted(name for name in signatures if name not in names)
    if missing:
        raise ReleaseError("signature without its bundle: " + ", ".join(missing))
    platforms: dict[str, dict[str, str]] = {}
    matched: set[str] = set()
    for suffix, keys in UPDATER_RULES:
        for name in sorted(names):
            if not name.endswith(suffix) or name not in signatures:
                continue
            if version not in name:
                raise ReleaseError(f"{name} is not a bundle of version {version}")
            signature = signatures[name].strip()
            if not signature:
                raise ReleaseError(f"{name}.sig is empty")
            matched.add(name)
            for key in keys:
                platforms.setdefault(
                    key,
                    {
                        "signature": signature,
                        "url": f"https://github.com/{repository}/releases/download/v{version}/{name}",
                    },
                )
    unknown = sorted(set(signatures) - matched)
    if unknown:
        raise ReleaseError(
            "no updater platform is known for: "
            + ", ".join(unknown)
            + " (add a rule to UPDATER_RULES in scripts/release-manifest.py)"
        )
    return {
        "version": version,
        "notes": notes.strip(),
        "pub_date": pub_date,
        "platforms": dict(sorted(platforms.items())),
    }


def _block(name: str, intro: str, checksums: list[tuple[str, str]]) -> str:
    lines = [f"<!-- {name}:start -->", intro]
    if checksums:
        lines += ["", "SHA-256"] + [
            f"- {asset}: {digest}" for asset, digest in checksums
        ]
    lines.append(f"<!-- {name}:end -->")
    return "\n".join(lines) + "\n"


def _pick(checksums: dict[str, str], *suffixes: str) -> list[tuple[str, str]]:
    return [
        (name, checksums[name])
        for suffix in suffixes
        for name in sorted(checksums)
        if name.endswith(suffix)
    ]


def build_blocks(checksums: dict[str, str], macos_signed: bool) -> dict[str, str]:
    """Download blocks by platform name. checksums maps an asset name to its SHA-256."""
    blocks: dict[str, str] = {}

    linux_x64 = _pick(checksums, "_amd64.AppImage", "_amd64.deb", ".x86_64.rpm")
    linux_arm = _pick(checksums, "_aarch64.AppImage", "_arm64.deb", ".aarch64.rpm")
    if linux_x64 or linux_arm:
        architectures = " and ".join(
            label
            for label, found in (("x86_64", linux_x64), ("arm64", linux_arm))
            if found
        )
        blocks["linux"] = _block(
            "linux",
            f"**Linux ({architectures})**: AppImage (updates itself), .deb and .rpm.",
            linux_x64 + linux_arm,
        )
    else:
        blocks["linux"] = _block("linux", f"**Linux**: {NOT_INCLUDED}", [])

    windows = _pick(checksums, "_x64-setup.exe", "_x64_en-US.msi")
    if windows:
        blocks["windows"] = _block(
            "windows",
            "**Windows 10 and 11 (x64)**: installer (.exe, updates itself) and .msi. The "
            "installer is not signed with a code signing certificate yet, so Windows "
            "SmartScreen may ask first: More info -> Run anyway.",
            windows,
        )
    else:
        blocks["windows"] = _block("windows", f"**Windows**: {NOT_INCLUDED}", [])

    macos = _pick(checksums, ".dmg", ".app.tar.gz")
    if not macos:
        blocks["macos"] = _block("macos", f"**macOS**: {NOT_INCLUDED}", [])
    elif macos_signed:
        universal = any("_universal." in name for name, _ in macos)
        blocks["macos"] = _block(
            "macos",
            ("**macOS (Apple silicon and Intel)**" if universal else "**macOS**")
            + ": signed with Developer ID and notarized by Apple.",
            macos,
        )
    return blocks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repository", required=True, help="owner/name")
    parser.add_argument("--notes-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--macos-signed",
        action="store_true",
        help="the macOS bundles in --assets-dir were signed and notarized by this run",
    )
    args = parser.parse_args()

    # latest.json and SHA256SUMS are outputs of the release, never inputs.
    asset_names = sorted(
        name
        for name in os.listdir(args.assets_dir)
        if name not in ("latest.json", "SHA256SUMS")
    )
    signatures = {}
    for name in asset_names:
        if name.endswith(".sig"):
            with open(os.path.join(args.assets_dir, name), encoding="utf-8") as handle:
                signatures[name[: -len(".sig")]] = handle.read()
    bundle_names = [name for name in asset_names if not name.endswith(".sig")]
    with open(args.notes_file, encoding="utf-8") as handle:
        notes = handle.read()

    try:
        manifest = build_manifest(
            bundle_names,
            signatures,
            args.version,
            args.repository,
            notes,
            datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
    except ReleaseError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if not manifest["platforms"]:
        print("error: the release has no signed bundle at all", file=sys.stderr)
        return 1

    checksums = {
        name: sha256_of(os.path.join(args.assets_dir, name)) for name in bundle_names
    }
    os.makedirs(args.output_dir, exist_ok=True)
    with open(
        os.path.join(args.output_dir, "latest.json"), "w", encoding="utf-8"
    ) as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    for name, block in build_blocks(checksums, args.macos_signed).items():
        with open(
            os.path.join(args.output_dir, f"{name}.md"), "w", encoding="utf-8"
        ) as handle:
            handle.write(block)
    print(f"latest.json {args.version}: {', '.join(manifest['platforms'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
