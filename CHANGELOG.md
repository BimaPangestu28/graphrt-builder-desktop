# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor
releases may contain breaking changes; they are called out under **Changed**.

## [Unreleased]

The desktop app now runs agents on the graphrt runtime instead of showing sample data.

### Added

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

[Unreleased]: https://github.com/BimaPangestu28/graphrt-builder-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BimaPangestu28/graphrt-builder-desktop/releases/tag/v0.1.0
