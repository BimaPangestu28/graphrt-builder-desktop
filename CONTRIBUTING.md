# Contributing

Thanks for helping improve graphrt desktop.

## Setup

graphrt desktop runs on macOS, Windows and Linux, and every change should keep
working on all three. You need Node.js 22+, pnpm 10+ and a stable Rust toolchain
(1.90 or newer), plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your system:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Windows**: Microsoft C++ Build Tools with "Desktop development with C++",
  WebView2 (preinstalled on Windows 11) and Git for Windows. Run the optional
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
scripts/fetch-node.sh   # optional local Node.js for debug builds (see below); Windows: in Git Bash
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

### The plugin runtime (Node.js, downloaded on demand)

graphrt plugins are Node programs. The app does **not** bundle Node: the first time the
user installs or sets up a plugin the UI asks (agents whose plugins lack it also show it under problems), and
`src-tauri/src/node_runtime/release.rs` downloads the official archive of the version in
`scripts/node-version` from `https://nodejs.org/dist/v<version>/` (that exact URL only,
size-capped), checks it against the SHA-256 pinned per platform in
`scripts/node-checksums.txt`, extracts only `bin/node` (`node.exe` on Windows) and installs
it atomically as `<app data>/runtime/node-<version>/node`, after running `node --version`.

- **The pin.** `src-tauri/build.rs` compiles `scripts/node-version` and
  `scripts/node-checksums.txt` into the binary and fails the build when they disagree.
  `scripts/fetch-node.sh --update-checksums` writes the checksums file from the
  GPG-verified `SHASUMS256.txt` (signature checked against pinned Node.js release keys);
  CI runs `scripts/fetch-node.sh --verify-checksums` with `GRAPHRT_REQUIRE_NODE_SIGNATURE=1`.
- **To upgrade Node**: change `scripts/node-version`, run
  `scripts/fetch-node.sh --update-checksums`, commit both files.
- **macOS signing**: Node's release binaries carry the Node.js project's Developer ID,
  hardened runtime and their own JIT / library-validation entitlements, so the downloaded
  `node` (spawned as a separate process) JITs and loads native addons such as `sharp`
  regardless of graphrt's entitlements. The app's HTTP client sets no quarantine flag
  (one is removed defensively), so Gatekeeper does not prompt.
- **Development copy (optional).** `scripts/fetch-node.sh [<target-triple>...]` puts the same
  official binary at `src-tauri/binaries/graphrt-node-<triple>[.exe]` (gitignored). Debug
  builds use it when present (`GRAPHRT_IGNORE_DEV_NODE=1` skips it, to try the download
  flow), then a `node` on PATH. Release builds use only the downloaded runtime.
  `scripts/check-node-sidecar.mjs` (before `pnpm dev:desktop`) only warns about a missing
  or stale copy. `cargo test` / `cargo clippy` never need the network; the real download is
  an ignored test: `cargo test real_node_download -- --ignored`.

## Before opening a pull request

**Run `scripts/check.sh` before every push.** It runs the checks CI runs on Linux, in
the same order, and stops at the first one that fails:

```sh
scripts/check.sh            # everything below
scripts/check.sh --bundle   # also compile the release app, like the "desktop bundle" job
```

| Step | Command |
| --- | --- |
| Versions agree | `scripts/check-version.sh` |
| Dependencies | `pnpm install --frozen-lockfile` |
| Types | `pnpm typecheck` |
| Frontend tests | `pnpm test` |
| Frontend build (clippy needs `dist/`) | `pnpm build` |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` |
| Rust lints | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |

A push that fails one of these costs a CI run of about ten minutes to tell you what the
script tells you locally. On Windows, run it from Git Bash.

CI checks a pull request on Linux and Windows: clippy and the tests run on both, the
app is bundled on Linux. Two slower parts are optional and run on `main` after the merge:

- **Windows bundle**: add the `windows-bundle` label to a pull request that changes how
  the Windows app is built (`tauri.conf.json`, `build.rs`, bundled resources, the
  installer). The bundle then also has to pass before the pull request can be queued.
  It does not run again in the merge queue.
- **macOS**: add the `macos` label to a pull request that changes Apple-only code. It
  also runs every night.

Adding any label to an open pull request restarts its CI run, so add labels when you
open it.

Pull requests reach `main` through the merge queue: once the `ci-ok` check is green, a
maintainer queues the pull request (`gh pr merge --squash --auto`). The queue runs CI
again on top of `main` and of the pull requests queued before it, and merges only when
that run is green.

## Project layout

```
src/components/ui/      shared primitives (Logo, Icon, Button, Badge, StatusDot, Card)
src/components/layout/  AppShell and Sidebar used by every in-app screen
src/pages/              one page per screen, with a sub-folder for its parts
src/api/                typed Tauri command wrappers; only they may import api/sampleBackend/
src/api/sampleBackend/  browser-preview and test backend with its fixtures (not in the desktop build)
src/lib/                shared logic and app config
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

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml).
A release starts by itself when a version bump reaches `main`; nobody pushes a tag.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json` and `src-tauri/Cargo.lock` in one go:
   ```bash
   scripts/bump-version.sh 0.2.1
   ```
2. In `CHANGELOG.md`, move the `Unreleased` notes under `## [0.2.1] - YYYY-MM-DD`
   and update the compare links at the bottom. Check the release notes render:
   ```bash
   scripts/changelog-section.sh 0.2.1
   ```
3. Run the checks above and `pnpm build:desktop`, then commit
   (`chore: release v0.2.1`), open a pull request and merge it. Everything in `main`
   up to that commit is in the release.
4. When the commit lands on `main`, the Release workflow sees a version with no
   `v0.2.1` tag. It checks that every version is the same
   (`scripts/check-version.sh`) and that the CHANGELOG section exists, creates the tag
   on that commit, and builds a **draft** release titled "Graphrt Desktop 0.2.1":
   - Windows x64 (`.msi`, NSIS `.exe`) and Linux x64 and arm64 (`.AppImage`, `.deb`,
     `.rpm`), ready after about 15 minutes with the updater signatures (`.sig`),
     `latest.json` and `SHA256SUMS`;
   - macOS (universal `.dmg` and `.app.tar.gz`), signed and notarized, added to the
     same draft (and to `latest.json` and `SHA256SUMS`) when its job finishes.
5. Review the draft on GitHub (keep "What's new" to short bullets in plain language,
   since the readers are mostly not engineers, and keep every
   `<!-- name:start -->` / `<!-- name:end -->` marker as is) and publish it by hand;
   the workflow never publishes. Installed apps pick the update up from
   `releases/latest/download/latest.json` within six hours (or right away with
   Settings > Updates > Check for updates).

Under "Download" the draft has one block per platform. A platform whose build is
missing says **not in this release yet**, and the summary of the workflow run says why.
macOS does not hold the other platforms back, so check its block before publishing:

- **The Apple secrets are not set** (see below): the macOS job is skipped. An app
  that is not signed and notarized is never attached.
- **The macOS job failed, or waited more than two hours for a runner** (the run is
  then cancelled): the draft stays complete for Windows and Linux.

Either publish without macOS and add it later, or add it first:

- Re-run the Release workflow from the Actions tab with the tag (`v0.2.1`). It reuses
  the draft, keeps your edits of the notes and rebuilds every platform. The
  `macos_runner` input switches between Intel (`macos-26-intel`, the default) and
  Apple silicon (`macos-latest`) runners when one of them has no capacity.
  "Re-run failed jobs" on the run does the same for only the jobs that failed.
- Or build on a Mac with the backup script, which signs, notarizes and adds the Apple
  silicon build to the draft or to the published release:
  ```bash
  git checkout v0.2.1
  scripts/changelog-section.sh 0.2.1 > /tmp/notes.md
  scripts/release-macos-local.sh 0.2.1 /tmp/notes.md --draft
  ```
  Without `--draft` the script publishes the release; its header lists what it needs.

Other things to know:

- A release that is already published is never changed by the workflow.
- If the workflow stops before it creates the tag (for example a missing CHANGELOG
  section), fix `main` and start it from the Actions tab with no tag: it releases the
  version on `main` when that version has no tag yet.
- Pushing a `vX.Y.Z` tag by hand still starts the same build, and a manual run with a
  tag that does not exist creates it on the selected branch.
- CI runs `scripts/check-version.sh` on every push, so the three versions can never drift.
- `scripts/finalize-release.sh` writes `latest.json`, `SHA256SUMS` and the platform
  blocks from the files attached to the draft; its rules are tested with
  `python3 -m unittest discover -s scripts/tests`.

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

### Google sign in for Google Cloud (Put it online)

"Put it online" signs people in to Google Cloud with the **Graphrt Desktop** OAuth client
(type Desktop app, project `graphrt`). Its client id is in
`src-tauri/src/deploy/google_cloud.rs`; its client secret is not a real secret for an
installed app, but it stays out of the source and reaches the build as
`GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET` (repository secret of the same name, passed by the
Release workflow). A build without it says signing in to Google Cloud is not available.
For a local build, export it from the client's JSON (never print it):
`export GRAPHRT_GOOGLE_CLOUD_CLIENT_SECRET="$(jq -r .installed.client_secret <client>.json)"`.
`GRAPHRT_GOOGLE_CLOUD_CLIENT_ID` replaces the built-in client id (another OAuth client).
The consent screen asks for `cloud-platform`, a sensitive scope: until Google has verified the
app, people see "Google hasn't verified this app" and at most 100 accounts can sign in.

### macOS signing and notarization

The Release workflow attaches macOS only when it can sign and notarize it. That needs
all six of these repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the exported "Developer ID Application" `.p12` (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Apple Developer team id |

The first three sign the app, the last three notarize it. When any of them is missing
the macOS job is skipped, the run warns which names are missing, and the draft says
macOS is not in the release: an app that is only ad-hoc signed is never attached,
because Gatekeeper would stop users at the first launch.
