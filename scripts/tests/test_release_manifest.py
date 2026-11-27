"""Tests of scripts/release-manifest.py. Run: python3 -m unittest discover -s scripts/tests"""

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "release-manifest.py"
_spec = importlib.util.spec_from_file_location("release_manifest", SCRIPT)
release_manifest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release_manifest)

REPOSITORY = "Graphrt/graphrt-builder-desktop"
LINUX_AND_WINDOWS = [
    "graphrt-0.2.0-1.aarch64.rpm",
    "graphrt-0.2.0-1.x86_64.rpm",
    "graphrt_0.2.0_aarch64.AppImage",
    "graphrt_0.2.0_amd64.AppImage",
    "graphrt_0.2.0_amd64.deb",
    "graphrt_0.2.0_arm64.deb",
    "graphrt_0.2.0_x64-setup.exe",
    "graphrt_0.2.0_x64_en-US.msi",
]


def manifest_for(bundles: list[str], unsigned: tuple[str, ...] = ()) -> dict:
    signatures = {name: f"sig of {name}\n" for name in bundles if name not in unsigned}
    return release_manifest.build_manifest(
        bundles, signatures, "0.2.0", REPOSITORY, "notes\n", "2026-01-01T00:00:00Z"
    )


class BuildManifestTest(unittest.TestCase):
    def test_same_platform_keys_and_urls_as_the_published_0_2_0_manifest(self):
        bundles = LINUX_AND_WINDOWS + [
            "graphrt_0.2.0_aarch64.app.tar.gz",
            "graphrt_0.2.0_aarch64.dmg",
        ]
        manifest = manifest_for(bundles, unsigned=("graphrt_0.2.0_aarch64.dmg",))
        base = f"https://github.com/{REPOSITORY}/releases/download/v0.2.0/"
        expected_urls = {
            "darwin-aarch64": "graphrt_0.2.0_aarch64.app.tar.gz",
            "darwin-aarch64-app": "graphrt_0.2.0_aarch64.app.tar.gz",
            "linux-aarch64": "graphrt_0.2.0_aarch64.AppImage",
            "linux-aarch64-appimage": "graphrt_0.2.0_aarch64.AppImage",
            "linux-aarch64-deb": "graphrt_0.2.0_arm64.deb",
            "linux-aarch64-rpm": "graphrt-0.2.0-1.aarch64.rpm",
            "linux-x86_64": "graphrt_0.2.0_amd64.AppImage",
            "linux-x86_64-appimage": "graphrt_0.2.0_amd64.AppImage",
            "linux-x86_64-deb": "graphrt_0.2.0_amd64.deb",
            "linux-x86_64-rpm": "graphrt-0.2.0-1.x86_64.rpm",
            "windows-x86_64": "graphrt_0.2.0_x64-setup.exe",
            "windows-x86_64-msi": "graphrt_0.2.0_x64_en-US.msi",
            "windows-x86_64-nsis": "graphrt_0.2.0_x64-setup.exe",
        }
        self.assertEqual(
            {key: entry["url"] for key, entry in manifest["platforms"].items()},
            {key: base + name for key, name in expected_urls.items()},
        )
        self.assertEqual(manifest["version"], "0.2.0")
        self.assertEqual(manifest["notes"], "notes")
        self.assertEqual(
            manifest["platforms"]["windows-x86_64"]["signature"],
            "sig of graphrt_0.2.0_x64-setup.exe",
        )

    def test_universal_macos_archive_serves_both_architectures(self):
        manifest = manifest_for(["graphrt_0.2.0_universal.app.tar.gz"])
        self.assertEqual(
            sorted(manifest["platforms"]),
            [
                "darwin-aarch64",
                "darwin-aarch64-app",
                "darwin-x86_64",
                "darwin-x86_64-app",
            ],
        )

    def test_architecture_archive_wins_over_the_universal_one(self):
        manifest = manifest_for(
            ["graphrt_0.2.0_universal.app.tar.gz", "graphrt_0.2.0_aarch64.app.tar.gz"]
        )
        self.assertTrue(
            manifest["platforms"]["darwin-aarch64"]["url"].endswith(
                "_aarch64.app.tar.gz"
            )
        )
        self.assertTrue(
            manifest["platforms"]["darwin-x86_64"]["url"].endswith(
                "_universal.app.tar.gz"
            )
        )

    def test_without_macos_there_is_no_darwin_platform(self):
        manifest = manifest_for(LINUX_AND_WINDOWS)
        self.assertFalse(
            [key for key in manifest["platforms"] if key.startswith("darwin")]
        )

    def test_unknown_signed_file_is_an_error(self):
        with self.assertRaisesRegex(
            release_manifest.ReleaseError, "graphrt_0.2.0_riscv.zip"
        ):
            manifest_for(["graphrt_0.2.0_riscv.zip"])

    def test_bundle_of_another_version_is_an_error(self):
        with self.assertRaisesRegex(
            release_manifest.ReleaseError, "not a bundle of version"
        ):
            manifest_for(["graphrt_0.1.9_amd64.AppImage"])

    def test_empty_signature_is_an_error(self):
        with self.assertRaisesRegex(release_manifest.ReleaseError, "is empty"):
            release_manifest.build_manifest(
                ["graphrt_0.2.0_amd64.deb"],
                {"graphrt_0.2.0_amd64.deb": " \n"},
                "0.2.0",
                REPOSITORY,
                "notes",
                "2026-01-01T00:00:00Z",
            )

    def test_signature_without_its_bundle_is_an_error(self):
        with self.assertRaisesRegex(
            release_manifest.ReleaseError, "without its bundle"
        ):
            release_manifest.build_manifest(
                [],
                {"graphrt_0.2.0_amd64.deb": "sig"},
                "0.2.0",
                REPOSITORY,
                "notes",
                "2026-01-01T00:00:00Z",
            )


class BuildBlocksTest(unittest.TestCase):
    def test_missing_platforms_say_so(self):
        blocks = release_manifest.build_blocks(
            {"graphrt_0.2.0_amd64.deb": "aa"}, macos_signed=False
        )
        self.assertIn("**Linux (x86_64)**", blocks["linux"])
        self.assertIn("- graphrt_0.2.0_amd64.deb: aa", blocks["linux"])
        self.assertIn("**Windows**: not in this release yet.", blocks["windows"])
        self.assertIn("**macOS**: not in this release yet.", blocks["macos"])
        for name, block in blocks.items():
            self.assertTrue(block.startswith(f"<!-- {name}:start -->\n"))
            self.assertTrue(block.endswith(f"<!-- {name}:end -->\n"))

    def test_macos_attached_by_this_run_is_described_as_signed(self):
        checksums = {
            "graphrt_0.2.0_universal.dmg": "dd",
            "graphrt_0.2.0_universal.app.tar.gz": "tt",
        }
        block = release_manifest.build_blocks(checksums, macos_signed=True)["macos"]
        self.assertIn(
            "**macOS (Apple silicon and Intel)**: signed with Developer ID and notarized",
            block,
        )
        self.assertIn("- graphrt_0.2.0_universal.dmg: dd", block)

    def test_macos_attached_by_someone_else_keeps_their_block(self):
        blocks = release_manifest.build_blocks(
            {"graphrt_0.2.0_aarch64.dmg": "dd"}, macos_signed=False
        )
        self.assertNotIn("macos", blocks)


class CommandLineTest(unittest.TestCase):
    def run_script(
        self, assets: dict[str, str], *extra: str
    ) -> tuple[subprocess.CompletedProcess, pathlib.Path]:
        root = pathlib.Path(self.enterContext(tempfile.TemporaryDirectory()))
        (root / "assets").mkdir()
        for name, content in assets.items():
            (root / "assets" / name).write_text(content, encoding="utf-8")
        (root / "notes.md").write_text("### Added\n\n- A thing\n", encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--assets-dir",
                str(root / "assets"),
                "--version",
                "0.2.0",
                "--repository",
                REPOSITORY,
                "--notes-file",
                str(root / "notes.md"),
                "--output-dir",
                str(root / "out"),
                *extra,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return result, root / "out"

    def test_ignores_a_previous_manifest_and_checksum_file(self):
        result, out = self.run_script(
            {
                "graphrt_0.2.0_amd64.AppImage": "bundle",
                "graphrt_0.2.0_amd64.AppImage.sig": "signature\n",
                "latest.json": '{"version": "0.1.0"}',
                "SHA256SUMS": "old",
            }
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((out / "latest.json").read_text(encoding="utf-8"))
        self.assertEqual(
            sorted(manifest["platforms"]), ["linux-x86_64", "linux-x86_64-appimage"]
        )
        self.assertEqual(manifest["notes"], "### Added\n\n- A thing")
        self.assertIn(
            "not in this release yet", (out / "macos.md").read_text(encoding="utf-8")
        )
        self.assertNotIn("latest.json", (out / "linux.md").read_text(encoding="utf-8"))

    def test_fails_when_nothing_is_signed(self):
        result, _ = self.run_script({"graphrt_0.2.0_amd64.AppImage": "bundle"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("no signed bundle", result.stderr)


if __name__ == "__main__":
    unittest.main()
