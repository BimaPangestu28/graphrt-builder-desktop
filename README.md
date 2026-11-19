# graphrt desktop

[![CI](https://github.com/BimaPangestu28/graphrt-builder-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/BimaPangestu28/graphrt-builder-desktop/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Overview
Desktop app for building, testing and running automation agents on your own computer: macOS, Windows or Linux. Describe a job in plain words, review the steps graphrt drafts, approve test runs, then schedule the agent to run on its own.

The UI is implemented from the **graphrt Builder Mockup** design canvas (25 desktop screens, 01 Welcome to 25 Menu bar / tray). The three "Mobile (later)" boards are not implemented yet.

> **Status: preview.** Every screen works with sample data, but the app is not yet connected to the [graphrt runtime](https://github.com/BimaPangestu28/graphrt), so no agent actually runs. See [CHANGELOG.md](CHANGELOG.md).

## Features
- Agent builder flow: new agent → building → review steps → connect WhatsApp → test run and approval → schedule
- Home dashboard, scheduler, runs, inbox with human take-over, knowledge bases
- Chained agents, agents as steps, agent teams, customer chatbots
- Connections, settings, error states, version history

## Prerequisites
Running a prebuilt app needs nothing else (it ships its own Node.js). The supported systems:

| System | Versions | Notes |
| --- | --- | --- |
| macOS | Apple silicon and Intel (one universal app) | Keys and secrets go to the macOS Keychain |
| Windows | 10 (1803+) and 11, x64 | Uses WebView2 (preinstalled on Windows 11; the installer adds it on Windows 10). Keys go to Windows Credential Manager |
| Linux | x64 and arm64, glibc 2.35+ (Ubuntu 22.04, Debian 12, Fedora 36 or newer) | Needs WebKitGTK 4.1, a Secret Service keyring (GNOME Keyring or KWallet, running on most desktops) and AppIndicator for the tray icon |

Building from source needs:
- Node.js 22+ and pnpm 10+
- Rust 1.90+ (stable)
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Microsoft C++ Build Tools ("Desktop development with C++"), WebView2, and Git for Windows (its Git Bash runs `scripts/fetch-node.sh`)
  - **Linux** (Debian / Ubuntu; see the Tauri page for Fedora, Arch, openSUSE):
    ```bash
    sudo apt install build-essential pkg-config file patchelf libwebkit2gtk-4.1-dev \
      libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev
    ```

## Installation

### Download
Prebuilt apps are attached to each [GitHub Release](https://github.com/BimaPangestu28/graphrt-builder-desktop/releases),
with a `SHA256SUMS` file to verify them (`shasum -a 256 -c SHA256SUMS --ignore-missing`
on macOS, `sha256sum -c SHA256SUMS --ignore-missing` on Linux,
`Get-FileHash <file>` in PowerShell on Windows):

| System | Download | Install |
| --- | --- | --- |
| macOS (universal) | `graphrt_<version>_universal.dmg` | Open the `.dmg` and drag graphrt to Applications |
| Windows x64 | `graphrt_<version>_x64-setup.exe` (NSIS) or `graphrt_<version>_x64_en-US.msi` | Run the installer; the `.exe` installs for your user only, without admin rights |
| Linux x64 / arm64 | `.AppImage`, `.deb` or `.rpm` (`amd64` / `x86_64` or `arm64` / `aarch64`) | `.deb`: `sudo apt install ./graphrt_<version>_amd64.deb`; `.rpm`: `sudo dnf install ./graphrt-<version>-1.x86_64.rpm`; `.AppImage`: `chmod +x` it and run it (needs FUSE 2, `libfuse2` on Ubuntu) |

The app ships its own **Node.js 22 LTS** runtime, which graphrt plugins run on,
so you do not need to install Node. It adds about 110 MB per architecture to the
installed app (about 37 MB to the download); the universal macOS app carries both
architectures (about +225 MB installed, +75 MB download). Plugins that drive a
browser (Google Maps scraper, WhatsApp Web) download Chromium on first use into
Playwright's usual cache (`~/Library/Caches/ms-playwright` on macOS,
`%USERPROFILE%\AppData\Local\ms-playwright` on Windows, `~/.cache/ms-playwright`
on Linux): roughly 250 MB to download and 600 MB on disk. Node's licence and the
notices of the libraries it bundles ship inside the app at
`licenses/node-LICENSE.txt` (in `graphrt.app/Contents/Resources` on macOS).

> **Builds are not signed yet.** **macOS**: on first launch, right-click the app in
> Applications and choose **Open**, then confirm. On macOS 15 or later, if there is
> no Open button, go to System Settings > Privacy & Security and click **Open Anyway**.
> **Windows**: if SmartScreen says "Windows protected your PC", click **More info**,
> then **Run anyway**.

#### Updates
graphrt checks for a new version on launch and every six hours, downloads it in the
background and shows **graphrt X is ready — Restart** when it is ready. Nothing
restarts on its own: if agents are running, Restart offers **Restart when idle**.
Settings > Updates has **Check for updates**, the release notes and an
**Automatically download updates** switch. Updates are signed; an update whose
signature does not match is rejected. On Linux, in-app updates replace the
`.AppImage`; `.deb` / `.rpm` installs update in-app too (the system asks for your password).

#### Linux notes
- **Tray icon**: graphrt keeps running agents from the system tray. GNOME hides tray
  icons unless the [AppIndicator extension](https://extensions.gnome.org/extension/615/appindicator-support/)
  is on (Ubuntu enables it by default). Without a tray icon, closing the window quits
  graphrt; with one, starting graphrt again brings the window back.
- **Keys and secrets** are stored through the Secret Service (GNOME Keyring, KWallet).
  On a minimal window manager without one, install and start `gnome-keyring`, or
  saving a key fails with a "credential store error".
- **Keep the computer awake while an agent runs** uses `systemd-inhibit` (systemd-logind).
- **Browser plugins**: if Chromium fails to start, install its system libraries once,
  e.g. `sudo npx playwright install-deps chromium` (needs Node), or your distribution's
  `libnss3`, `libgbm1`, `libasound2` packages.

### From source
```bash
pnpm install
scripts/fetch-node.sh   # bundled Node.js sidecar for this machine (once, ~40 MB download)
                        # Windows: run it in Git Bash, or `bash scripts/fetch-node.sh`
```
`pnpm dev:desktop` and `pnpm build:desktop` stop with a message pointing at
`scripts/fetch-node.sh` when the sidecar is missing or outdated. `cargo test` and
`cargo clippy` do not need it.

## Quick Start
```bash
pnpm dev:desktop   # Tauri window with hot reload (starts Vite on :5173)
pnpm dev           # UI only, in the browser at http://localhost:5173
```
Open `#/screens` to jump to any screen from the design.

## Usage
| Command | What it does |
| --- | --- |
| `pnpm dev:desktop` | Run the desktop app in development |
| `pnpm build:desktop` | Build the desktop bundles for this system into `src-tauri/target/release/bundle` (`.app` / `.dmg` on macOS, `.msi` / NSIS `.exe` on Windows, `.AppImage` / `.deb` / `.rpm` on Linux) |
| `pnpm build` | Typecheck and build the web UI into `dist/` |
| `pnpm test` | Run the Vitest suite |
| `pnpm typecheck` | TypeScript only |

## Project structure
```
src/
  components/ui/      Shared primitives: Logo, Icon, Button, Badge, StatusDot, Card
  components/layout/  AppShell and Sidebar used by every in-app screen
  pages/              One page per design screen (+ sub-folders for its parts)
  data/               Mock data until the runner backend exists
  routes.ts           Route path for every screen
  index.css           Design tokens (Tailwind @theme) taken from the mockup
src-tauri/            Rust shell (Tauri 2): window, bundling, future local runner
```

## Configuration
- Window size, app identifier and CSP: `src-tauri/tauri.conf.json`
- Update endpoint and the updater's public key: `plugins.updater` in `src-tauri/tauri.conf.json`
- Bundled Node.js version: `scripts/node-version` (fetched by `scripts/fetch-node.sh`)
- Design tokens (colors, font): `src/index.css`

## Privacy
graphrt sends no telemetry. Agents, runs, keys and settings stay on your computer.

**Crash reports are local.** When graphrt crashes (a backend panic) or a screen hits an error it cannot handle, a report is saved to `crash-reports/` in the app data folder (Settings > Privacy and data shows where), one JSON file per crash, at most 50 (the oldest are deleted) and 64 KB each. A report holds the app version, the system and architecture, the time, the error message, where it happened (file and line, or the screen's route without its query string), the thread and the backtrace or stack. Before it is written, graphrt removes:
- your home folder (shown as `~`) and your account name
- keys and tokens: `Bearer …`, `sk-…` and other provider key formats, `api_key=`, `token:`, `password=` and similar values, and long random-looking strings
- email addresses

Reports never contain your secrets, workflow inputs, run outputs or file contents.

Nothing is sent anywhere. In **Settings > Privacy and data > Crash reports** you can view each report exactly as stored, export them all to one `.json` file or delete them. After a crash, the next launch shows a small notice with **View** and **Dismiss**. If you turn on **Help improve graphrt: offer to share crash reports** (off by default), the notice also offers **Open a GitHub issue**: it opens a new issue in your browser with a title and a short summary filled in, which you can edit before you submit it, or close.

## Contributing
Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and commit style, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License
Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution and the use of the graphrt name and logo.
