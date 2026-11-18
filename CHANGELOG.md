# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor
releases may contain breaking changes; they are called out under **Changed**.

## [Unreleased]

The desktop app now runs agents on the graphrt runtime instead of showing sample data.

### Added

- **Local storage**: agents with their version history, runs with every event and
  paused-run snapshots, schedules and settings, in one SQLite file in the app data folder.
- **Keychain**: model provider keys (OpenAI, Anthropic, Gemini) and workflow secrets
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
  HTML, EPUB), whole folders or website links; they are indexed on this Mac in the
  background with live status, re-synced without re-reading unchanged files, and
  searchable from the Knowledge screen. Works without any API key (local embeddings
  plus keyword search); uses OpenAI embeddings when an OpenAI key is set. Agents
  search them with graphrt's `knowledge-retrieval` step, by knowledge base id or name.

### Changed

- Agent screens are addressed by agent id (`/agents/<id>/steps`, `/test`, `/schedule`...).
- Welcome and Connections save real provider keys; Home and the sidebar list real agents.

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
