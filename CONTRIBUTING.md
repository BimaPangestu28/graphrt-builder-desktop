# Contributing

Thanks for helping improve graphrt desktop.

## Setup

graphrt desktop runs on macOS, Windows and Linux, and every change should keep
working on all three. You need Node.js 22+, pnpm 10+ and a stable Rust toolchain
(1.90 or newer), plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your system:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Windows**: Microsoft C++ Build Tools with "Desktop development with C++",
  WebView2 (preinstalled on Windows 11) and Git for Windows. Run
  `scripts/fetch-node.sh` from Git Bash (it needs bash, curl, unzip or
  PowerShell, and gpg, all included); `pnpm` commands work in any shell.
- **Linux** (Debian / Ubuntu 22.04+; package names for other distributions are on
  the Tauri page; add the D-Bus headers for the Secret Service keyring):
  ```sh
  sudo apt install build-essential pkg-config file patchelf libwebkit2gtk-4.1-dev \
    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev
  ```
  Running the app (and the ignored keyring test) needs a Secret Service such as
  GNOME Keyring; the tray icon needs AppIndicator support in your desktop.

Then:

```sh
pnpm install
scripts/fetch-node.sh   # bundled Node.js sidecar (see below); Windows: in Git Bash
pnpm dev:desktop   # desktop window with hot reload
pnpm dev           # interface only, in the browser at http://localhost:5173
```

### Writing cross-platform code

- **Copy**: say "this computer", not "this Mac". Where the system's own name
  helps, use `src/lib/platform.ts` (`getCredentialStoreName()` for macOS Keychain /
  Windows Credential Manager / your system keyring, `getTrayAreaName()` for menu
  bar / system tray, `getFileManagerName()`, `formatShortcut('Enter')` for
  ⌘+Enter / Ctrl+Enter). Tests run with a macOS user agent (`src/test/setup.ts`);
  spy on `navigator.userAgent` to check another system.
- **Rust**: put OS-specific code behind `cfg(target_os = ...)` / `cfg(windows)`
  with a working fallback for the other systems (see `src-tauri/src/desktop/keep_awake.rs`),
  build paths with `Path::join` and Tauri's path API (never hard-coded `/` or
  `~/Library`), and start console programs on Windows without a console window.
- CI runs clippy and `cargo test` on macOS, Windows and Ubuntu, so `cfg` code for
  each system is compiled there even if you only have one machine. Locally you
  can at least check std-only code for another target with
  `rustup target add x86_64-pc-windows-msvc` and `cargo check --target ...` on a
  small crate; the full app needs the target's system libraries.

Open `#/screens` to jump to any screen.

### Bundled Node.js

graphrt plugins are Node programs, so the app ships Node as a Tauri sidecar
(`bundle.externalBin: ["binaries/graphrt-node"]`). `scripts/fetch-node.sh [<target-triple>...]`
downloads the version pinned in `scripts/node-version` from nodejs.org, checks it
against `SHASUMS256.txt` (whose signature is verified against pinned Node.js
release keys when `gpg` is installed; CI makes gpg mandatory with
`GRAPHRT_REQUIRE_NODE_SIGNATURE=1`) and writes `src-tauri/binaries/graphrt-node-<triple>[.exe]`
(gitignored). Supported targets: `aarch64-apple-darwin`, `x86_64-apple-darwin`,
`universal-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`,
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`. The default target is the host; `universal-apple-darwin` fetches
both macOS arches and lipo's them into `node-universal-apple-darwin`, which Tauri
needs for `--target universal-apple-darwin`.

- `pnpm dev:desktop` / `pnpm build:desktop` run `scripts/check-node-sidecar.mjs`
  first and stop with the fetch command when the sidecar is missing or outdated.
  Nothing is downloaded automatically, so builds never hit the network by surprise.
- `cargo test` / `cargo clippy` / `cargo build` (debug) work without the sidecar:
  `src-tauri/build.rs` then drops `externalBin` and warns; the app falls back to
  a `node` on PATH in debug builds only. Release cargo builds fail without it.
- To upgrade Node, change `scripts/node-version`, run `scripts/fetch-node.sh`
  and commit `src-tauri/licenses/node-LICENSE.txt` if the script updated it.

## Before opening a pull request

```sh
pnpm typecheck
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project layout

```
src/components/ui/      shared primitives (Logo, Icon, Button, Badge, StatusDot, Card)
src/components/layout/  AppShell and Sidebar used by every in-app screen
src/pages/              one page per screen, with a sub-folder for its parts
src/data/               sample data, until the runtime is connected
src/routes.ts           the route of every screen
src/index.css           design tokens (Tailwind theme)
src-tauri/              Rust shell (Tauri 2)
```

## Code guidelines

- Use the design tokens (`bg-ink`, `text-muted`, `border-line`...) instead of raw
  colors, and reuse `components/ui` and `components/layout` before writing new
  primitives.
- Keep pages small: split a screen into parts under `src/pages/<screen>/`.
- Use real controls for interaction (`<button>`, `<a href>`, `<input>` with a
  `<label>`), add `aria-label` to icon-only buttons and keep text contrast at
  4.5:1 or higher.
- Add tests for every behavior change: render the page in a `MemoryRouter` and
  assert what the user sees and does.
- Rust: no `unwrap()`, `expect()` or `panic!()` outside tests and app start-up;
  return typed errors. Document public items.
- Never put real customer data, phone numbers or API keys in sample data or
  tests. Use placeholders such as `[CAFE NAME]`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat(inbox): ...`, `fix(sidebar): ...`, `docs: ...`, `refactor(runs): ...`.
Add user-facing changes to the `Unreleased` section of `CHANGELOG.md`.

## Reporting security issues

Please report vulnerabilities privately through GitHub security advisories
rather than public issues. See [SECURITY.md](SECURITY.md).

## Releasing (maintainers)

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml)
when a `vX.Y.Z` tag is pushed.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json` and `src-tauri/Cargo.lock` in one go:
   ```bash
   scripts/bump-version.sh 0.2.0
   ```
2. In `CHANGELOG.md`, move the `Unreleased` notes under `## [0.2.0] - YYYY-MM-DD`
   and update the compare links at the bottom. Check the release notes render:
   ```bash
   scripts/changelog-section.sh 0.2.0
   ```
3. Run the checks above and `pnpm build:desktop`, then commit
   (`chore: release v0.2.0`) and merge to `main`.
4. Tag the release commit and push the tag:
   ```bash
   git tag -a v0.2.0 -m "v0.2.0" && git push origin v0.2.0
   ```
5. The workflow checks that every version equals the tag
   (`scripts/check-version.sh v0.2.0`), creates a **draft** release with the
   CHANGELOG section as its body, builds macOS (universal `.dmg` and `.app.tar.gz`),
   Windows x64 (`.msi`, NSIS `.exe`) and Linux x64 and arm64 (`.AppImage`, `.deb`,
   `.rpm`) bundles, and
   attaches them with a `SHA256SUMS` file, the updater signatures (`.sig`) and
   `latest.json`. Review the draft on GitHub and publish it: installed apps pick
   the update up from `releases/latest/download/latest.json` within six hours
   (or right away with Settings > Updates > Check for updates).

To rebuild an existing tag (for example after a failed job), run the Release
workflow manually from the Actions tab with that tag; it reuses the draft and
refuses to touch a release that is already published. CI runs
`scripts/check-version.sh` on every push, so the three versions can never drift.

### Auto-update signing key (required)

Installed apps only accept updates signed with the updater key whose public half
is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The Release workflow
fails early without these repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file (e.g. `~/.tauri/graphrt-updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password (empty if the key has none) |

Keep a backup of the private key and its password somewhere safe (a password
manager). **If the key is lost, apps already installed can never verify another
update**: users would have to download and install a new build by hand. Never
commit the key. To sign a local `pnpm build:desktop`, export the same two variables
(or `TAURI_SIGNING_PRIVATE_KEY_PATH`); without them the build stops when it reaches
the updater artifacts. A new key pair comes from
`pnpm tauri signer generate -w ~/.tauri/graphrt-updater.key`; replacing the
public key in `tauri.conf.json` cuts off updates for every existing install.

### macOS signing and notarization

Without signing secrets the macOS app is ad-hoc signed only, so Gatekeeper asks
users to confirm the first launch. To ship a signed and notarized app, add these
repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the exported "Developer ID Application" `.p12` (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Apple Developer team id |

The first three enable signing; the last three also enable notarization. Any
group left empty is skipped with a warning instead of failing the build.
