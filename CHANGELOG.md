# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor
releases may contain breaking changes; they are called out under **Changed**.

## [Unreleased]

### Performance

- **Smaller app: `graphrt.app` 28.2 → 16.1 MiB, updater `.app.tar.gz` 12.9 → 9.1 MiB; the binary 29.4 → 16.7 MB** (Apple Silicon release build, `tauri build`). The release profile now optimizes for size (`opt-level = "z"`) with fat LTO, and keeps the crates on a run's hot path (the graphrt-core engine, serde_json, tokio) at `opt-level = 3`: graphrt-core's engine benchmark (1000-node chain, 100-item parallel iteration) runs at the same speed as before (1.63 vs 1.60 ms, 0.55 vs 0.56 ms), and the engine, knowledge, flow and scheduler tests take as long as before. `z` everywhere was ~45% slower on that benchmark; `s` with fat LTO gave 20.9 MB. Release builds take a little longer (fat LTO).
- **Frontend 4.5 → 3.2 MB on disk**: ELK (the Nodes view layout) ships once, as its Web Worker; the 1.4 MB in-thread copy is gone (every Tauri webview has workers). If the worker cannot start, the canvas places the steps in a row and the next layout tries a fresh worker. Production builds target the Tauri webviews (`es2022`, `chrome110`, `safari15`) instead of Vite's older default, so less syntax is transpiled.
- **No network request before the first paint**: the Geist typeface ships with the app (variable weight, woff2, 77 kB for all subsets; a window loads only the ones it needs) instead of a render-blocking stylesheet from Google Fonts, which also delayed startup offline. The CSP no longer allows fonts.googleapis.com / fonts.gstatic.com.
- Common screens (Home, Builder, Runs, test run and result, Connections, Settings, Plugins) load in the background once the window is idle, so their first visit does not flash a loading state.

### Changed

- **The app no longer bundles Node.js** (it was 79% of the macOS app). Apple Silicon release build: `graphrt.app` 114.5 MiB → 28.2 MiB, updater `.app.tar.gz` 44.6 → 12.9 MiB, `.dmg` 50.0 → 13.9 MiB (the app binary grows 0.2 MB for the xz/zip readers). Plugins run on the "plugin runtime", the official Node.js release pinned in `scripts/node-version`, which graphrt downloads from nodejs.org the first time it is needed and only after the user says so: installing a plugin shows "Also downloads the plugin runtime (Node.js, about 30 MB download)" in the same approval, and the Plugins page, plugin pages, the builder's plugin card, Home's problems and Settings › Runner › Plugin runtime offer **Install plugin runtime**. The archive's SHA-256 is pinned per platform in `scripts/node-checksums.txt` (generated from Node's GPG-signed `SHASUMS256.txt` by `scripts/fetch-node.sh --update-checksums`, verified in CI) and compiled into the app by `build.rs`; only `https://nodejs.org/dist/v<version>/<archive>` is fetched (size-capped), only `bin/node` is extracted, and it is installed atomically into `<app data>/runtime/node-<version>/` after `node --version` checks out. Offline, the install fails with a clear message and can be retried. Settings can remove it again.
- **Updating from 0.1.x**: installed plugins need the runtime once. A notice ("Your plugins need a one-time download") offers **Download now** or **Later**; nothing downloads until the user clicks. "Later" is remembered for that Node version, and the Plugins page banner, the plugin's setup steps, the builder card and Home's problem list keep offering it. A run whose plugin could not start for lack of it is explained as "The plugin runtime is not installed", with an install button.
- `scripts/fetch-node.sh` now maintains the checksum pin (`--update-checksums`, `--verify-checksums`) and, optionally, a development copy in `src-tauri/binaries/` that debug builds use (unstripped, exactly as released). Release builds and CI no longer fetch or bundle Node; `scripts/check-node-sidecar.mjs` only warns before `pnpm dev:desktop`; the release script refuses an app that still contains `graphrt-node`.

### Added

- `scripts/release-macos-local.sh`: build (or reuse a build), sign with Developer ID, notarize and staple the app and dmg, sign the updater bundle, write `latest.json` and publish a GitHub release from a Mac. Notarizes with an App Store Connect API key (`NOTARY_KEY`, `NOTARY_KEY_ID`, `NOTARY_ISSUER`) or a notarytool keychain profile.

### Fixed

- The browser runtime's install progress shows Playwright's output lines again (the app read only `message`, while the backend sends `line`).

## [0.1.4] - 2026-11-22

### Security

- **"It asks before anything is sent" has no more side doors** (builder `validate_draft` and the
  Nodes view): HTTP methods are read the way graphrt-http reads them (trimmed, any case), so
  `" Post "` counts as writing; any `http-request` (GET included) whose URL, params, headers,
  authorization or body reads a `{{#…#}}` value (inputs, earlier steps, `env` secrets), or that
  has a body, now sends; `tool` steps and plugin steps send unless their operation clearly only
  reads (a conservative name check: unknown names send; graphrt-plugins manifests have no
  "sends" field to read instead); `agent` steps send when a sending tool is not listed in their
  own `require_approval`; steps that reach outside and read output of a model step on Codex
  (`output_needs_send_approval`), directly or through other steps, send. An approval whose
  `on_timeout` answers with a button that leads to a sending step is a blocking problem
  (`approval_timeout_sends`, "Sends when time runs out"); only `stop` or a non-sending button is
  allowed, and a run of such a flow saved earlier stops on timeout instead. The cafe example now
  asks before its Maps search, and the builder prompt explains the rules.
- **Keychain values are always masked**: env values read from the keychain are passed as
  graphrt secrets even when the document leaves out `type: secret`, so a draft cannot unmask a
  stored key in events, stored runs or prompts. Plain document defaults (`value:`) stay plain.
  A stored non-secret setting read in a model prompt now reaches it masked; use a document
  default or a run input for text the model should read.
- **Chromium install runs with a clean environment** from an installed plugin only: the
  Playwright installer gets `PATH`, `PLAYWRIGHT_BROWSERS_PATH`, home and temp folders, proxy and
  `PLAYWRIGHT_*` settings, nothing else of the app's environment (API keys, tokens), and
  `install_browser_runtime` refuses a plugin folder (or a Playwright CLI it resolves to,
  links followed) outside the app's plugins folder.
- **MCP bearer tokens only over HTTPS**: an MCP server with a bearer token must use
  `https://`, or `http://` to `localhost`, `127.0.0.1` or `::1`; a definition saved earlier with
  plain `http://` does not send its token.
- **Plugin downloads reach public addresses only**: catalog and tarball downloads (and their
  redirects) refuse hosts that are or resolve to loopback, private, link-local (cloud metadata)
  or reserved addresses, using graphrt-http's egress rules in the connection's DNS resolver.
- **Installing a plugin says it runs code**: the install approval on the Plugins page, the
  plugin page, the Add node palette and the builder's plugin card say "Installing a plugin runs
  its code on this computer. Trust only plugins you know."
- **Dependencies**: react-router-dom 7.18.5 (React Router open redirect / XSS advisories),
  vite 6.4.5, vitest 4.1.12 (no tinypool), @vitejs/plugin-react 4.7.0; `pnpm audit` is clean.
- **Codex on this computer runs no commands**: `--sandbox read-only` still let Codex run shell
  commands that read the whole disk, and `codex exec` never asks. Every call now also switches
  its tools off (`-c features.shell_tool=false`, `features.unified_exec=false`, images, browser,
  computer use, apps, plugins, hooks, sub-agents, `web_search="disabled"`,
  `approval_policy="never"`, an empty command environment) and, where `codex exec --help` lists
  it, `--ignore-user-config` so the user's own MCP servers and hooks are not loaded. If Codex
  still starts a command or any other tool (a `command_execution`, MCP, web search or unknown
  `item.*` event, or the older `exec_command_begin` events), the call stops with "Codex tried
  to run a command; graphrt blocks that". Codex answers are also flagged for the
  approval-before-send rule (`local_cli::capability::output_needs_send_approval`).
- **Approving a plugin never trusts more than you saw**: installing now carries the permissions
  shown next to the Install button (the builder's requirement card, the Plugins page, Connect
  WhatsApp, the Add node palette) as the limit for the downloaded manifest, so a catalog entry
  that lists fewer settings or no secrets than its tarball is refused and nothing is installed.
  Trusting (`set_plugin_trusted`) now needs the approved permissions too and is refused, with
  the extra settings or secrets named, when the installed manifest asks for more; untrusting
  needs no approval. The `install_plugin` command takes `permissions`, `set_plugin_trusted`
  takes `permissions` when trusting.
- **Plugin detail cache keys no longer collide**: saved catalog v2 details are named
  `plugin-details/<name>@<version>.json` (`@` is valid in neither part), so `a` + `b-1.0.0` and
  `a-b` + `1.0.0` no longer share one file. Details saved under the old dash names are removed
  and fetched again. A detail kept in memory is only reused while the index lists the same
  `detail_sha256`; otherwise it is checked again or refetched.
- **Community plugin updates wait for you**: automatic updates no longer install new versions
  of `source: community` plugins (by the catalog entry or the install record) in the
  background, even when they ask for nothing new; they are left in `needs_approval`. "Update
  all" still offers them, with the usual permission limit.
- **Catalog entry and tarball must describe the same release**: installs and updates refuse a
  downloaded manifest whose `version` differs from the catalog entry's or whose `name` is not
  the entry's name, before anything is replaced.
- **Plugin archives cannot exhaust memory with headers**: the decompressed tar stream is capped
  (the 1 GiB file cap plus room for headers), and a raw pass over the headers refuses any GNU
  long-name / long-link entry or pax header over 64 KiB before it would be read into memory, and
  any pax header that overrides an entry size. Catalog tarballs and sideloaded archives alike.
- **Sideloaded folders cannot be swapped while they are copied**: each folder is checked again
  right before it is read (still a real folder, not a link or junction, and still inside the
  chosen folder once resolved), and each file is opened without following links (`O_NOFOLLOW`
  on Unix; `FILE_FLAG_OPEN_REPARSE_POINT` on Windows, refusing reparse points) and must be the
  file that was listed (same device and inode on Unix).
- **One catalog entry per plugin name**: when a catalog lists a name twice, the official entry
  is kept (else the first one) and the others are dropped and logged, so a community entry can
  never stand in for an official plugin.
- **Plugin names and publishers cannot be spoofed with invisible characters**: catalog
  `display_name` and `publisher` values with Unicode format characters (`Cf`: bidi overrides
  and isolates, zero-width characters, soft hyphens, tags) are dropped like those with control
  characters, and a community entry's `display_name` or `publisher` containing "official" or
  "graphrt" (any case) is dropped. The entry stays listed under its humanized name.
- **Catalog assets must come from the catalog's own releases**: `tarball_url`, `icon_url` and
  `detail_url` must be under the catalog repository's `/releases/download/` (by default
  `https://github.com/BimaPangestu28/graphrt-plugins/releases/download/`; the prefix comes
  from the configured catalog URL, or its folder for a catalog not on GitHub releases),
  checked on the normalized URL. Entries with a tarball elsewhere are dropped; an icon or
  detail link elsewhere only loses that field. Redirects to GitHub's asset hosts still work.
- **No downgrade from catalog v2 to v1**: once `index-v2.json` was fetched on a computer (kept
  as `plugin-catalog-v2.seen` next to the saved catalogs), a missing or unusable v2 no longer
  falls back to v1 `index.json`; the saved v2 copy is used and the problem is logged. A saved
  v1 copy is ignored from then on.
- **Detail prune on case-insensitive file systems**: on macOS and Windows, pruning compares
  saved detail file names ignoring case, so a listed version saved with another case is not
  removed (a saved file is still checked against the index checksum before use).
- **The plugin catalog must be signed**: after `index-v2.json` or `index.json` is downloaded,
  `<index url>.minisig` (at most 4 KB) is downloaded and the index bytes must verify against a
  built-in minisign public key (a list, so a key rotation can ship two keys; currently key id
  `CB1AEE339F05C2BD`) before they are parsed. There is no grace mode
  (`REQUIRE_CATALOG_SIGNATURE`) and no user setting to change the keys. A missing or invalid
  signature makes the index unusable: the saved copy is used, the error is logged and returned
  as the catalog's new `fetchError` (shown on the Plugins page). The saved copy keeps its
  `.minisig` and is verified again whenever it is read. A v2 index with a bad or missing
  signature never falls back to v1, and v1 must be signed too. Details, icons and tarballs stay
  covered by the sha256 values in the signed index.

### Added

- **More AI tools already signed in on this computer (Experimental)**: Gemini CLI
  (`gemini-cli`), Cursor CLI (`cursor-cli`), GitHub Copilot CLI (`copilot-cli`), OpenCode
  (`opencode-cli`) and Qwen Code (`qwen-code-cli`) join Claude Code and Codex, with the same
  rules: off until the user turns them on, never the automatic default, no usage spent until
  "Check connection", credential files never read and no secret on the command line, and every
  call runs in a throwaway folder with no tools, no file writes and no shell:
  - Gemini CLI: prompt on stdin, `--output-format stream-json --approval-mode default` and a
    `--policy` file denying every tool (`toolName = "*"`), `GEMINI_SYSTEM_MD` replacing the
    built-in coding prompt, `--skip-trust` for the throwaway folder.
  - Cursor CLI: `-p --output-format stream-json --mode ask --trust`, a workspace
    `.cursor/cli.json` denying shell, read, write, web and MCP tools; its docs only take the
    prompt as an argument, so the prompt goes into the workspace's `AGENTS.md` and the
    argument is a fixed request.
  - GitHub Copilot CLI: prompt on stdin, `--output-format json`, `--deny-tool` for shell,
    write, read, url and memory plus `--excluded-tools` for every built-in tool,
    `--disable-builtin-mcps --no-ask-user --no-custom-instructions`.
  - OpenCode: `opencode run --format json --agent graphrt-text-only` with an inline config
    agent whose permission is `{"*": "deny"}` (also `OPENCODE_PERMISSION`), CLAUDE.md and
    project config loading off; models from `opencode models`, sign-in from `opencode auth list`.
  - Qwen Code: prompt on stdin, `--output-format stream-json --approval-mode default
    --exclude-tools …`, `--extensions none`, `--max-tool-calls 0`, `--chat-recording false`,
    `QWEN_SYSTEM_MD`.
  A tool-use event from any of them stops the call with a plain message. Detection reports
  "Not installed" with the official install page (opened through `open_model_install_page`'s
  fixed allowlist). Welcome keeps Claude Code and Codex up front and lists the others under a
  compact "More AI tools on this computer" disclosure; Connections › AI models gets a card per
  found tool, with the ones not installed collapsed under "Other AI tools you can use"; model
  pickers list a tool's models once it is turned on.

### Changed

- **Local CLI providers are a per-CLI adapter registry** (`local_cli/adapter.rs`,
  `local_cli/adapters/*`): each CLI's flags, output parser, sign-in status and models live in
  one adapter citing its official docs; detection, the subprocess, timeouts, cancellation,
  prompts and capability errors are shared. Claude Code and Codex behave as before.
- **Frontend sample data has one home**: `src/data/` is gone. Design fixtures live under
  `src/api/sampleBackend/fixtures/`, app config in `src/lib/` (settings choices, run limits,
  the schedule calendar) or next to the screen that uses it, and shared shapes in
  `src/api/*Types.ts`. Screens no longer read mocks: the browser preview's agent names, app
  requirements, default Runs selection and pinned Scheduler week come from
  `getPreviewContent()`, which is null in the desktop app. A test fails when code outside
  `src/api` and tests imports the sample backend. Knowledge "Used by" links open the agent's
  builder, like the sidebar.
- **Nodes editor internals split up without behaviour changes**: `useAgentGraph` keeps its
  working copy and undo / redo in one reducer (`sync/graphHistory.ts`), so two edits in the
  same tick both apply; positions and the builder lock are their own hooks. The canvas body's
  keyboard shortcuts, context menu, clipboard and connect mode are separate hooks, and the
  inspector's Start inputs, template field and tool panel are smaller pieces.
- **One error helper**: `src/lib/errors.ts` (`toError`, `toErrorMessage`) replaces six local
  copies; `BackendError.details` is typed per code (`version_conflict`, `invalid_graph`,
  `builder_busy`) and checked when it arrives. The duplicate `missing_plugins` code is gone.
- **Canvas plugin labels match the rest of the app** ("WhatsApp Web", not "Whatsapp Web"):
  they use the shared plugin display name.
- **Steadier tests**: Testing Library waits up to 5 s, the sample builder's pretend pauses are
  zero in tests unless a test steps through them, and the builder chat ignores a change that
  finishes after the screen closed.

### Performance

- **Smaller start-up bundle**: every screen is loaded on first visit and the Nodes canvas
  (React Flow) only when its tab opens; the desktop build no longer ships the sample backend
  or its fixtures. The entry chunk goes from 1,317 kB (402 kB gzip) to 241 kB (78 kB gzip).
- **Auto-layout off the main thread**: ELK runs in a Web Worker (`elk-api` +
  `elk-worker`), so laying out a large graph no longer freezes the canvas.
- **Fewer canvas re-renders during a run**: the run clock has its own context read only by the
  elapsed time of a running step, a question's deadline and the run bar; the node decoration
  and note providers are memoized, so a tick no longer re-renders the canvas or the cards
  (guarded by a render-count test).
- **Live run events are cheaper**: in-order events are appended instead of rebuilding and
  sorting the whole list, bursts (streamed text) are applied once per frame, and the run
  object only changes when its status does. The Runs detail panel no longer rebuilds its steps
  on every clock tick.

- **Smaller app binary**: release builds use thin LTO, one codegen unit and stripped symbols
  (`panic = "unwind"` stays for the Linux tray fallback). The macOS arm64 binary goes from
  41.7 MB to 28.7 MB (-31%).
- **Smaller bundled Node.js**: `scripts/fetch-node.sh` strips debug symbols from the verified
  Node binary (`strip -x` plus an ad-hoc signature on macOS, `strip --strip-unneeded` on Linux,
  Windows unchanged) and checks it still runs (`node -e 1`): 113.0 MB to 90.6 MB on macOS
  arm64. `GRAPHRT_SKIP_NODE_STRIP=1` keeps the download as is; signature checks are unchanged.
- **Live view stops polling when idle**: the frame watcher polls every 100 ms only while pages
  are live, a run starts a step, or for 15 s after either; otherwise once a second (was 10
  times a second forever).
- **Cheaper database writes**: SQLite runs in WAL mode with `synchronous = NORMAL` and a
  5 s busy timeout; storing a run event no longer reads the run's status first (the foreign
  key checks it), and a buffered chunk plus the next event are stored in one transaction.
- **Approval time limits without a 15 s tick**: the expiry task reads only paused runs
  (`runs_by_status` index) and sleeps until the earliest deadline (at most 60 s), woken early
  when a run pauses. The start-up check is kept.
- **Plugin catalog kept in memory**: the known catalog (with its v2 details) is parsed and
  verified once and reused until a fetch replaces it or a detail is downloaded or pruned,
  instead of re-reading the saved index and up to 148 detail files on every builder, prompt
  guide or plugin-name call. The saved v1 copy is deleted once v2 was fetched.
- **Faster start-up**: pruning old run events and publishing the saved plugin catalog run on a
  background thread after the window opens. Installed plugins and MCP servers are now
  published before the scheduler and approval expiry start, so a run started by the first
  scheduler tick always sees them.

## [0.1.3] - 2026-11-22

### Added

- **Use Claude Code or Codex already signed in on this computer (Experimental)**: two new
  model providers, `claude-code-cli` and `codex-cli`, run the user's own installed CLI as a
  subprocess, the way they would in a terminal. graphrt never reads, copies or logs their
  credential files or tokens and never puts a secret on the command line (the prompt goes
  through stdin, Claude Code's system prompt through a file). Each call runs in a throwaway
  working folder with no tools (Claude Code `-p --output-format stream-json --tools ""` plus
  `--safe-mode` and friends when the installed version lists them; Codex `exec --json
  --sandbox read-only --ephemeral`), streams its answer, has a timeout, and the process is
  killed on Stop run / Stop the builder. Detection looks in `PATH`, the common install folders
  and the login shell's `PATH` (macOS GUI apps do not inherit it) and reads the version and the
  CLI's own sign-in status; no prompt is sent until "Check connection". Both are off until the
  user turns them on, never the automatic default, and say that usage counts against the
  Claude / ChatGPT plan (API keys stay the recommended path for shared apps). Plain text,
  structured output and "Extract parameters" work; "Run an agent" steps with tools and image
  input are reported by graph validation and the builder before a run. New commands:
  `set_local_cli_enabled`, `check_local_cli`, `open_model_install_page`,
  `get_welcome_choice` / `set_welcome_choice`; `list_provider_statuses` takes `refresh` and
  reports `localCli` detection.

### Changed

- **First launch asks "How should graphrt think?"**: Claude Code or Codex on this computer
  (detected, with install links), a local model with Ollama, an API key, or "Skip for now —
  explore first". No key is needed to start; the choice is remembered. Connections › AI models
  gets cards for both CLIs (Turn on, Check connection, Use by default, model choice, Detect
  again), model pickers list their models, and "add an API key" messages now point to all the
  ways to connect a model. A missing model reads "not set up yet: an AI model (…)".

## [0.1.2] - 2026-11-21

### Changed

- **Update popup in the corner**: the bottom-right toast now also appears when a new version is available (Update / Later, with "You have X") and while it downloads (progress, Hide), not only once it is ready. "Later" is remembered for that version across restarts; a newer version shows it again.

### Added

- **Plugin source and publisher**: catalog entries (v1 and v2) may carry `source` (`official`
  or `community`; missing means official, anything else is treated as official and logged),
  `publisher` (trimmed, at most 60 characters, no control characters) and `repository_url`
  (https only); invalid values are dropped, not the entry. They reach the catalog view, are
  kept in the install record and are returned on installed plugins. Community plugins get a
  "Community" badge on their card and plugin page (official plugins stay unbadged), the plugin
  page says "by <publisher>" and has "View the source code" (opened in the default browser via
  the new `open_plugin_repository`, like the README), and the install confirmation says the
  plugin is reviewed by the graphrt maintainers but maintained by its publisher.
- **Install plugins from a folder or archive (Developer mode)**: Settings › About › Developer
  mode (off by default) adds "Install from folder or archive…" on the Plugins page, using the
  system file picker (the existing `dialog:allow-open` permission; no new capability). The new
  `install_local_plugin(path, replace)` command, refused while Developer mode is off, accepts a
  folder or a `.tar.gz`: archives go through the same safe extraction as catalog tarballs (size
  and entry caps, no links, devices, absolute paths or `..`); folders are copied with the same
  caps, refusing any symlink, junction or special file inside (never followed) and skipping
  `.git`, and a folder inside the app's plugins folder is refused. The copy is then checked and
  moved into place by the catalog install path (manifest rules, the manifest's file checksums,
  node kind registration). The plugin is recorded as `source: local` with the picked path,
  labelled "Local · not reviewed", starts untrusted (also when reinstalled) and is never
  auto-updated, offered as an update, matched against a catalog plugin of the same name or
  replaced by a catalog install. Replacing a plugin installed from the catalog needs a
  confirmation (the command answers with the new `conflict` error code) and drops that
  plugin's saved settings. Removing a local plugin works as before.

- **Plugin catalog v2**: the app reads the slim `index-v2.json` of the graphrt-plugins `catalog`
  release first (at most 4 MiB) and falls back to v1 `index.json` (16 MiB, as before) when v2 is
  missing (404), not valid JSON, too large or uses an unknown schema; the log says which one was
  used. Each is saved under its own name (`plugin-catalog-v2.json`, `plugin-catalog.json`) and the
  newer saved copy is used offline. v2 entries list `node_kinds` (kind and title) and `tools`, and
  point at an immutable per-version detail file (`detail_url`, `detail_sha256`,
  `detail_size_bytes`, checked like `readme_url` / `icon_url`; invalid ones are dropped, not the
  entry) holding each node's description, `config_schema` and `outputs`. Details are fetched on
  demand (plugin page via the new `list_plugin_catalog_steps`, install, builder) and in a
  background sync after every catalog fetch (missing ones only, 4 at a time, never blocking),
  verified (HTTPS, size at most 1 MiB and as listed, sha256, same name and version) and kept in
  `plugin-details/<name>-<version>.json`; versions the index no longer lists are pruned. Offline,
  only saved details are used. The builder's step types, draft validation of plugins that are not
  installed, requirements and the plugin page read nodes from the details (or `node_kinds` until a
  detail is cached); with the v1 fallback nothing changes. `list_plugin_catalog` also returns
  `fetched_at`, when this session fetched the catalog. A 404 from a download is now reported as
  `not_found`.
- **Check for updates on the Plugins page**: a "Check for updates" button fetches the catalog again
  (`list_plugin_catalog` with `refresh: true`), shows "Checking for updates…" meanwhile, then
  "Updated just now · catalog published <date>", and says why it failed (or that only the saved
  copy could be shown). When the page opens with a catalog the app fetched more than 10 minutes
  ago, the saved list shows at once and a fresh one is fetched in the background. A plugin page of
  a plugin that is not installed lists its steps from the catalog detail, fetched on demand.
- **Agent tool approvals**: a "Run an agent" step whose tools are set to ask first
  (`require_approval`) pauses with graphrt's `tool_approval` kind, and the app can now answer it.
  Each tool call shows as its own question (tool, provider when the step's `tools` list names it,
  arguments as pretty JSON with secret-looking values hidden) with Allow / Decline, in the Test run
  approval card, Home "Needs you" ("Wants to use send_message"), Runs and Review a run (screen 19,
  where calls of one step are answered in one resume). Answers resume with
  `{"approvals": {"<call id>": true|false}}`. Stored pause reasons get `provider` / `tool` and
  redacted arguments; graphrt keeps the real arguments in its snapshot. graphrt sends no reason for a
  call and has no "allow for the rest of this run" answer, so neither is offered.
- **Approval time limits that expire**: an "Ask me before continuing" step with `timeout_ms` now
  expires. Its stored pause reason gets `expires_at` and `on_timeout`; the step chooses
  `on_timeout: { action: <button id> }` (answer with that button and the fields' defaults) or
  `on_timeout: stop` (the default: the run ends as stopped). graphrt moves a node's top-level
  `timeout_ms` into its run policy, so the desktop reads the step's limit from there. A background
  check every 15 seconds (and at start-up) applies the action, stores an `approval_timed_out` event
  ("Timed out → Skip" in the run log), and keeps the deadline of questions still waiting after
  another one was answered. Approval cards and review rows show "Expires in 2h, then Skip".
- **Editable run limits** (Settings › Runner › Run limits): time for one step (default 2 minutes),
  active time for one run (30 minutes), step attempts per run (10,000), loops inside loops (8) and
  steps at the same time (64) are app settings (`app.run_limits.*`, `AppSettings.runLimits`) with
  safe ranges, explanations and Reset to defaults. Out-of-range values are refused on save and
  clamped on load; every run, resume and chatbot turn reads them.

## [0.1.1] - 2026-11-21

The desktop app now runs agents on the graphrt runtime instead of showing sample data.

### Added

- **Automatic plugin updates and an Updates notice on Home**: "Automatically update plugins" (on by
  default; Settings → Updates and "Update automatically" next to the Plugins tabs, stored as
  `app.auto_update_plugins`). About a minute after launch and then every 6 hours the catalog is
  fetched again and installed plugins with another catalog version are updated in the background,
  only when the new version asks for nothing more than the installed one (no new settings, no
  plaintext secrets). The downloaded manifest is checked against that limit before it replaces
  anything, so trust never changes silently. Updates asking for more wait for the user ("needs your
  approval"; the catalog view now carries `update_needs_approval`, and the card offers "Review
  update"). Nothing updates while an agent run is running or paused (retried after 15 minutes), and
  nothing is ever installed or removed. Automatic updates are remembered (`plugins.auto_updated`,
  last 20; `list_plugin_auto_updates`). Home shows a compact, dismissible Updates notice: the app
  update (ready → Restart, downloading, or available → Download), plugin updates with Review and
  "Update all" (`update_all_plugins`, which skips updates needing approval), updates needing
  approval, and "Updated automatically: X 0.2.0 → 0.2.1" for 24 hours. Dismissing hides it until
  something new appears. The Plugins sidebar item shows how many plugin updates are waiting.
- **Plugin display names**: plugins are labelled with a name people read ("WhatsApp Cloud API",
  "Currency Rates") instead of their technical name (`whatsapp-api`). The catalog's optional
  `display_name` is trimmed and accepted up to 60 characters without control characters; an invalid
  one (or a non-string) drops only that field, never the entry. It is saved in the install record so
  installed plugins keep it offline, and an installed plugin picks up a name the catalog adds later.
  Without one (older catalogs, local installs) the name is humanized: words title-cased, acronyms in
  capitals (`-api` → API, AI, CRM, CSV, PDF, QR, SQL, SFTP, RSS, OCR, S3, …), known brands spelled
  their way (GitHub, OpenAI, WhatsApp, YouTube, …) and small joining words lower-case. The catalog
  view, installed plugins and agent plugin requirements carry `displayName`; it shows on Plugins
  page cards, the plugin page title (with the technical name as small text under it), the builder's
  plugin setup cards and "Needs" rows, Home's plugin chips, "Needs you" and Updates notice, the
  WhatsApp setup steps, trust and settings labels, errors, and Problems titles. Plugins page search
  matches the display name and the technical name. The technical name stays the identifier in
  install calls, routes, node kinds and logs.
- **Plugin icons**: the catalog's optional `icon_url` (https only; a bad link drops only the icon) is
  shown on Plugins page cards, plugin pages and the builder's plugin setup cards. The app downloads
  each SVG once (64 KB cap, 10 s timeout, https-only redirects), keeps it in `plugin-icons/` next to
  the catalog cache so it works offline, and serves it to the UI as a `data:` URL through
  `get_plugin_icon`, rendered only with `<img>` so scripts in an SVG never run. The CSP is unchanged
  (`img-src 'self' data:`). Plugins without an icon, or whose icon fails, keep their monogram tile.
- **Plugins page**: plugins have their own sidebar item (after Knowledge) at `/plugins` instead of
  Connections → Advanced. The catalog is an equal-height card grid (monogram, status badge, two-line
  description, Internet / Secrets / settings / Browser chips, step count, Install / Update / Set up /
  Open) with All · Installed · Updates · Needs attention tabs (with counts), search over names,
  descriptions and step titles, and category chips (derived from names, since the catalog has no
  category). Installing from a card first asks, naming what the plugin gets. A compact browser
  runtime banner shows while an installed plugin needs Chromium. Each plugin has a page at
  `/plugins/:pluginName`: status and Install / Update / Remove, the README warning (with the
  catalog's terms-of-service risk), set up (trust, browser runtime, the WhatsApp QR link, required
  settings first), the steps it adds, what it asks for, which agents use it and a README button that
  opens the browser (`open_plugin_readme`). The catalog view now carries `warning`, `status` and
  `tos_risk`. Builder "Needs" rows and Home's plugin chips open the plugin's page; the tour, problem
  actions and chatbot channels open Plugins; `/connections?section=plugins` redirects there.
- **"Find businesses on Maps and message them on WhatsApp" template**, first in the gallery: it asks the
  builder for a Google Maps search (area, kind of business and how many as run inputs), a short personal
  message per business, "Ask me before sending" with the exact message, sending from your own WhatsApp
  (linked by QR), a low-volume limit and a run report. Every template card now shows what it needs as
  chips plus a short "You'll need" note, and Home's describe box links to it and to all templates.
- **Auto-update**: graphrt checks GitHub Releases on launch and every six hours, downloads a new
  version in the background (Settings > Updates > "Automatically download updates", on by default)
  and shows a small "graphrt X is ready — Restart" banner. Restarting while agents run asks first and
  offers "Restart when idle". Settings > Updates shows the version, "Check for updates", the status
  and release notes. Updates are signed (`tauri-plugin-updater`); releases attach `latest.json` and
  `.sig` files and need the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets.
- **Local crash reports, no telemetry**: when the backend panics or a screen hits an unhandled error,
  graphrt saves a scrubbed JSON report in `crash-reports/` in the app data folder (at most 50, 64 KB
  each). Home folders become `~`, and account names, emails, bearer tokens, provider keys and
  `api_key=`-style values are removed; reports never hold secrets, workflow inputs, run outputs or
  file contents. Settings > Privacy and data > Crash reports lists them, shows each one exactly as it
  would be shared, exports them all to one `.json` file (save dialog) and deletes them. The launch after
  a crash shows a small notice (View · Dismiss); with the opt-in "Help improve graphrt: offer to share
  crash reports" it also offers a prefilled GitHub issue you review and submit yourself. A screen that
  breaks shows "Something went wrong" with Reload instead of a blank window. Settings says it plainly:
  graphrt sends no telemetry.
- **Windows and Linux, not just macOS**: the app and its copy work the same on all three. Text says
  "this computer"; where the system's own name helps it uses it: macOS Keychain, Windows Credential
  Manager or your system keyring for secrets, menu bar or system tray, Finder or File Explorer, and
  ⌘+Enter or Ctrl+Enter.
- **Keep the computer awake while an agent runs** now works on Windows (`SetThreadExecutionState`,
  re-checking the power source every minute for "only while plugged in") and Linux
  (`systemd-inhibit`), not only on macOS.
- Starting graphrt while it is already running shows the existing window instead of a second runner.
- Releases add Linux arm64 and `.rpm` packages; CI runs clippy and the Rust tests on macOS, Windows
  and Ubuntu. `scripts/fetch-node.sh` fetches Node for `aarch64-unknown-linux-gnu` and
  `aarch64-pc-windows-msvc` too. README and CONTRIBUTING list prerequisites and install steps per system.

- **Plugins are set up in the build chat**: the builder knows every plugin in the graphrt-plugins catalog
  (with each step's settings), so drafts use plugin steps even before they're installed. Right after a
  draft, the chat shows what each plugin needs — permissions, warnings, **Install & trust**, settings and
  the browser download — and Test waits until they're ready. Runs of agents with missing plugins are
  refused before they start.
- **Home that tells you what to do next**: Needs you lists failed runs, approvals, waiting chats, plugins
  or keys that aren't ready and broken schedules; agent cards show their real state with one next step;
  a Getting started checklist; recent runs explain errors in plain words; This month shows successes,
  failures, items sent and tokens.
- **Rename and delete agents** from the builder (click the name; Delete agent asks first).
- **Live test runs**: the step list shows only your steps in order, with live durations, "3 of 10 · Kopi
  Kenangan" progress for loops, and rows you can open to see streamed model text, outputs and errors
  in plain words. The chat column narrates the run; finished runs offer Run again and Edit steps.
  The Runs detail panel uses the same list.
- **Live browser view**: while a Google Maps search or web-browser step runs (also when an agent calls
  them as tools), a small live picture of the headless browser appears under the running step in Test
  and in the Runs detail panel. Frames stay on this computer and are never saved with the run (needs
  google-maps-scraper / web-browser 0.2.0 or later).
- The builder rejects drafts that call placeholder addresses such as api.example.com.
- **The builder streams its work**: while an agent is drafted or changed, Building and the builder chat
  show the model's explanation as it writes, the step titles as they appear and a live token count.
  Step details show references in plain words (‹name›) instead of template syntax.
- **Model picker lists every model your keys can use**: New agent, Settings and Connections ask each
  connected provider for its chat models (OpenAI, Anthropic, Gemini, DeepSeek, and the models pulled
  in Ollama), grouped by provider; the recommended model is shown while loading or when a provider
  can't be reached. Keys stay in the keychain; lists are cached for ten minutes.
- **Real data on New agent, Building, Home and the sidebar** in the desktop app: the prompt
  starts empty and the model chip shows the real default model (or links to Connections);
  templates fill in the description and kind instead of opening sample screens; Building
  opened without a request links back to New agent; the sidebar runner card names the
  connected provider and how many agents are scheduled; Home counts paused runs and
  waiting chats, shows the next scheduled run, each agent's schedule and this month's runs
  and AI tokens (new `get_usage_summary` command). The invented cost and "time saved" are gone.
- **When something goes wrong** (screen 23) lists real problems: the latest failed run of each
  agent (failing step and graphrt's error in plain words), missing provider keys, workflow
  secrets and plugin settings, plugins that are missing, broken or untrusted, the browser
  runtime for Playwright plugins, and schedules that no longer parse or keep failing. Each has
  buttons that open the screen or run the command that fixes it. "Retry from the start" starts
  a new run with the same inputs (graphrt cannot resume a failed run).
- **Scheduler** (screen 10) draws past runs from the run history, and its rules are stored:
  the missed-run default and keep-awake are app settings, and a new limit on scheduled runs at
  the same time is enforced by the scheduler (a schedule due beyond it skips that run).
- **Chatbot setup** is saved and used: the persona, tone, instructions and hand-off rules reach
  every bot reply (switched-off rules are enforced by the app), the chatbot answers from the
  knowledge bases attached on the setup screen, and WhatsApp/Telegram show as not connected
  with a link to Connections > Plugins until a channel is connected.
- **Team** activity and coordinator chat come from real runs of the team and its members;
  a message to the coordinator starts a team run. The "agent calls per run" guardrail is
  saved and enforced when the coordinator calls members.
- **Secrets** (Connections > Advanced): every `env.*` secret any agent declares or an MCP
  server needs, with who uses it and whether it is set; add, replace or remove values
  (password fields, stored in the keychain, never shown again).
- **MCP servers** (Connections > Advanced): add a server started by a command or reached by
  URL, with the secrets it needs; test the connection to list its tools. Every run can use
  them in `tool` and `agent` nodes (`<name>/<tool>` or `mcp:<name>`); the app connects only
  when a node uses a server. The builder knows the configured servers and their tools.
- **Settings**: run history retention (30 days, 90 days or forever; applied at start-up and
  when changed), a notification when a chatbot hands a conversation over, a daily summary
  notification at 18:00, the default model for new agents, the real data folder with Show in
  Finder, and the real app version.

- **Test run, run result and run review show only real run data**: the test run (06) starts
  from a form built from the flow's inputs (prefilled from the last run, whose inputs are now
  kept per run) and shows a paused `human-input` step exactly as graphrt sends it (prompt,
  form fields, actions); the result (07) shows only what the run reported; Review a run (19)
  lists the questions a paused run waits on (one per item for a parallel iteration, one at a
  time for a sequential one, with "all remaining") and resumes with every answer at once.
- **DeepSeek** as a model provider: add a key on Welcome or Connections and agents use
  `deepseek-chat` by default (`deepseek-reasoner` works too, with its reasoning streamed).
- **Plugins**: install graphrt plugins from the graphrt-plugins catalog (Connections > Plugins):
  permissions shown before install, HTTPS download checked against the catalog's sha256 and
  extracted safely, trust toggle, plugin settings in the keychain, browser runtime install.
  Plugin steps and tools work in every run, the builder knows the installed plugins, and the
  Needs panel lists the plugins a flow uses. Connect WhatsApp (screen 05) now sets up either
  the official WhatsApp Business API or a personal WhatsApp through WhatsApp Web (QR login).
- **Local storage**: agents with their version history, runs with every event and
  paused-run snapshots, schedules and settings, in one SQLite file in the app data folder.
- **Keychain**: model provider keys (OpenAI, Anthropic, Gemini, DeepSeek) and workflow secrets
  such as a Google Places key or a WhatsApp token are kept in the OS keychain. The
  interface can set or remove them but never read them back. Ollama works without a key.
- **Build an agent from a description**: the default model drafts a graphrt workflow,
  graphrt validates it, and problems go back to the model to fix (up to three calls).
  Drafts that would send messages or data without asking first are rejected.
  Chat changes in the builder are saved as new versions and highlight the changed steps.
- **Runs**: test runs stream each step live; runs pause for your approval and continue
  after Approve or Skip; Stop aborts. Runs list, details and raw log read real data.
- **Schedules**: weekday or custom schedules in your time zone, started by the app
  while it is open. A run missed while the Mac slept runs once on wake or is skipped,
  as you choose. Agents become Active or Paused with their schedules.
- **Needs panel**: the builder lists the keys and secrets an agent needs, and missing
  secrets can be added in place. A run will not start while one is missing.
- **Chatbot conversations**: the chatbot's Try it panel chats with its real workflow,
  which remembers the conversation between messages. When the workflow hands a chat
  over (an order to confirm, a question it cannot answer), the bot stops and the chat
  waits in the Inbox. You can take over, reply, hand it back or close it, and the
  Inbox, chat and sidebar count update live. The Inbox switch pauses the bot.
  WhatsApp and Telegram are not connected yet.
- **Agents as steps and teams**: every agent can be called by another one as a graphrt
  `tool` step (provider `agents`), getting back its outputs; a team is an `agent` step
  whose tools are its member agents. "Add" on the step catalog and "Add member" ask the
  builder for the change, saved as a new version. Calls refuse recursion, go at most three
  agents deep, stop after ten minutes, and fail clearly if the called agent asks for approval.
- **Chains**: "when this agent finishes, start that one" with input mapping, a run
  condition and a failure policy per link. Chains are activated or paused, can be tested
  from their first agent, and never run an agent twice in one pass.
- graphrt is used as a git dependency pinned to a commit until its crates are published.
- **Knowledge bases**: add files (PDF, Word, PowerPoint, Excel, CSV, Markdown, text,
  HTML, EPUB), whole folders or website links; they are indexed on this computer in the
  background with live status, re-synced without re-reading unchanged files, and
  searchable from the Knowledge screen. Works without any API key (local embeddings
  plus keyword search); uses OpenAI embeddings when an OpenAI key is set. Agents
  search them with graphrt's `knowledge-retrieval` step, by knowledge base id or name.
- **Menu bar icon**: shows whether the runner is online, how many agents are scheduled
  and how many runs wait for you, with Open graphrt, Pause all agents for 1 hour /
  Resume agents, and Quit graphrt. Closing the window keeps graphrt running so
  schedules still fire; quit from the menu bar or the app menu.
- **Notifications** when a run waits for your approval or fails; clicking one opens the run.
- **Settings › Runner, Notifications, Privacy and data** are saved: open at login, show in
  the menu bar, keep the Mac awake while an agent runs (only while plugged in, if you
  like), the default for missed runs, export all agents as JSON (never keys) and
  delete all data (optionally with the saved keys).
- The app opens on Welcome until a model provider is set up, and on Home afterwards.

### Changed

- Windows and Linux: the tray icon uses the color app icon (the black macOS template icon vanished on
  dark taskbars); if the tray icon cannot be created (a Linux desktop without AppIndicator) graphrt
  logs it and closing the window quits instead of hiding it where nothing could bring it back.
- Windows: MCP servers started with `npx`, `uvx` and other `.cmd` launchers now start (the bare name is
  resolved through `PATH` and `PATHEXT`), and checking the Node version no longer flashes a console window.
- Credential errors say "credential store error" instead of "keychain error".

- Fixed: the Steps/Source tabs on test runs, Close on Connect WhatsApp and the scheduler's New trigger
  opened the sample agent ("agent maps-leads not found"); they now use the agent you are on.

- Agent screens are addressed by agent id (`/agents/<id>/steps`, `/test`, `/schedule`...).
- Welcome and Connections save real provider keys; Home and the sidebar list real agents.
- The desktop app no longer shows sample content on Connections and Settings: no sample
  apps or "Connected" rows, and controls without a backend (appearance, language, model
  fallback, crash reports, remote runner) are hidden. The browser preview still shows them.

### Fixed

- **The full plugin catalog shows up again.** The app refused plugin catalogs over 2 MiB and silently kept
  its saved copy (6 plugins); with 146 plugins the published catalog is 2.0-3.5 MB. The limit is now 16 MiB.

### Known limitations

- Inbox, Chain, Team and Connect WhatsApp still show sample data.
- Run result and Home statistics fall back to sample content until workflows agree on
  output names.

## [0.1.0] - 2026-11-18

First public preview: the complete graphrt desktop interface, built from the
graphrt Builder design. Every screen works with sample data; it is **not yet
connected to the graphrt runtime**, so no agent actually runs.

### Added

**Desktop shell**
- Tauri 2 app (Rust) with a 1440×900 main window, 960×640 minimum size, strict
  content security policy and the graphrt loop icon for every platform.
- React 18 + TypeScript + Vite frontend, hash-based routing so the bundled app
  loads from disk.

**Design system**
- Color, type and spacing tokens from the design as Tailwind v4 theme values:
  ink and teal for the brand, amber for "waiting on you", green for healthy,
  red for errors. Geist as the interface font.
- Shared components: logo mark and lockup, stroke icon set, buttons and link
  buttons, badges, status dots, cards, and the app shell with its sidebar
  (empty, draft and agent list states, runner status, inbox count).

**Building an agent**
- 01 Welcome: pick a model provider, add an API key or use Ollama locally.
- 02 New agent: describe the job, choose the kind (task, chatbot, chain, team)
  or start from a template.
- 03 Building the agent: live checklist while the steps are drafted.
- 04 Review and edit steps: chat to change steps, with undo and redo.
- 05 Connect WhatsApp: pairing dialog with a refreshing QR code.
- 06 Test run and approval: approve, edit or skip each message before it is sent.
- 07 Test result: summary, places found and CSV export.
- 08 Schedule and activate: when to run, time zone, search inputs and approval rules.

**Running agents**
- 09 Home: what needs you, active agents, recent runs and monthly usage.
- 10 Scheduler: day, week and list views of every trigger, with pause and rules.
- 11 Chain agents, 12 Agent as a step and 13 Agent team.
- 19 Review a scheduled run: approve a batch of messages with per-item control.
- 20 Runs: filter by agent and status, step-by-step details, raw log and CSV export.
- 23 When something goes wrong: failed runs, reconnect and retry from the failed step.
- 24 Version history and undo: compare versions, restore and undo.

**Customer chat and knowledge**
- 14 Chatbot setup: persona, channels, hand-off rules, knowledge and a try-it chat.
- 15 Inbox and 16 Conversation: filter chats, take over from the bot and reply.
- 17 Knowledge and 18 Knowledge base detail: sources, sync and test questions.

**App**
- 21 Connections: model providers, apps, MCP servers and plugins.
- 22 Settings: runner, privacy and data, notifications and remote runner.
- 25 Menu bar and notifications.
- Screen index at `#/screens` to jump to any screen.

**Quality**
- 93 Vitest + Testing Library tests covering every screen and shared component.

### Known limitations

- No connection to the graphrt runtime yet: runs, approvals, schedules, inbox
  and knowledge use sample data from `src/data/`.
- The mobile companion screens from the design are not built.
- macOS builds are unsigned.

[Unreleased]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BimaPangestu28/graphrt-builder-desktop/releases/tag/v0.1.0
