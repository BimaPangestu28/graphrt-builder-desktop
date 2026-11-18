# graphrt desktop

[![CI](https://github.com/BimaPangestu28/graphrt-builder-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/BimaPangestu28/graphrt-builder-desktop/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Overview
Desktop app for building, testing and running automation agents on your Mac. Describe a job in plain words, review the steps graphrt drafts, approve test runs, then schedule the agent to run on its own.

The UI is implemented from the **graphrt Builder Mockup** design canvas (25 desktop screens, 01 Welcome to 25 Menu bar). The three "Mobile (later)" boards are not implemented yet.

> **Status: preview.** Every screen works with sample data, but the app is not yet connected to the [graphrt runtime](https://github.com/BimaPangestu28/graphrt), so no agent actually runs. See [CHANGELOG.md](CHANGELOG.md).

## Features
- Agent builder flow: new agent → building → review steps → connect WhatsApp → test run and approval → schedule
- Home dashboard, scheduler, runs, inbox with human take-over, knowledge bases
- Chained agents, agents as steps, agent teams, customer chatbots
- Connections, settings, error states, version history

## Prerequisites
- Node.js 22+ and pnpm 10+
- Rust 1.77.2+ (stable) with Xcode Command Line Tools on macOS ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Installation
```bash
pnpm install
```

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
| `pnpm build:desktop` | Build the desktop bundle (`.app` / `.dmg` on macOS) into `src-tauri/target/release/bundle` |
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
- Design tokens (colors, font): `src/index.css`

## Contributing
Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and commit style, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License
Licensed under the [Apache License 2.0](LICENSE).
