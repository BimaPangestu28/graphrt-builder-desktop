# Contributing

Thanks for helping improve graphrt desktop.

## Setup

You need Node.js 22+, pnpm 10+ and a stable Rust toolchain (1.77.2 or newer),
plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
your platform (Xcode Command Line Tools on macOS). Then:

```sh
pnpm install
pnpm dev:desktop   # desktop window with hot reload
pnpm dev           # interface only, in the browser at http://localhost:5173
```

Open `#/screens` to jump to any screen.

## Before opening a pull request

```sh
pnpm typecheck
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
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

1. Move `Unreleased` in `CHANGELOG.md` into a new version section and bump the
   version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Run the checks above and `pnpm build:desktop`.
3. Tag `vX.Y.Z` and push the tag, then attach the built bundles to the GitHub Release.
