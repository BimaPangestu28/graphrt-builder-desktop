# Meeting notes (local, Linux first)

Status: implemented on Linux (PipeWire). macOS and Windows follow behind the same traits.

graphrt notices that a meeting started on this computer, **asks** whether to take notes,
records the user's microphone and the computer's sound as two tracks, and hands the meeting
to the user's **agents**: a normal workflow transcribes it, summarizes it and sends it to
Notion, Slack, email or anything else a plugin reaches. No bot joins the call and no
Zoom / Meet / Teams API is used.

## Principle: no new feature area

Meeting notes are not a screen or a menu. They reuse what graphrt already has:

| Need | Existing concept it becomes |
|---|---|
| "When a meeting happens, do X" | a **trigger** of an agent, next to its schedules: *Also run when a meeting is recorded* on the Schedule screen (08) |
| Transcribe | a workflow **step**, `meeting.transcribe` (desktop built-in node kind, like `knowledge-retrieval`) |
| Summarize | the existing `llm` step |
| Send to Notion / Slack / email | the existing **plugin** steps (`notion.*`, `slack.*`, `email.*`…) |
| Build it from plain words | the **builder**: a guide teaches it the trigger inputs and the step ("after each meeting, send action items to Slack") |
| History, retries, failures, approvals | **Runs**, Problems and approvals, unchanged |

The only UI it adds:

1. **"Meeting detected. Take notes?"**: a system notification and the same card at the
   bottom right of the window (*Take notes* / *Not now*), with one line: *Let the others
   know you are taking notes.* Linux notifications cannot carry reliable action buttons
   through tauri-plugin-notification, so the choice is made on the card.
2. **Recording indicator with Stop**: a red pill "● Recording 12:34 · Stop" at the bottom
   right of every screen, and "● Recording meeting notes · Stop" at the top of the tray menu
   (works with the window closed).
3. **Settings > Runner > Meeting notes**: *Offer to take meeting notes* (off by default),
   *Keep meeting audio* (off by default), which agents get the notes, whether speech to
   text is installed.
4. On the Schedule screen of an agent: one checkbox, *Also run when a meeting is recorded*.

## Flow

```
Settings: "Offer to take meeting notes" on   +   ≥1 tested/active agent with the meeting trigger
        │
        ▼  every 3 s: who captures the microphone? (pw-dump)
Zoom on the mic for 5 s ──▶ notification + card "Meeting detected. Take notes?"  (never records by itself)
        │ Take notes                                   │ Not now → quiet until the mic is free
        ▼
pw-record ×2: mic.wav (You) + system.wav (Others)      pill + tray "Recording · Stop"
        │ Stop  ─ or ─  Zoom leaves the mic: after 10 s "The meeting seems over, notes stop in 20 s"
        │                (Keep recording cancels; Zoom coming back cancels) → stops at ~30 s
        ▼
every agent with the meeting trigger starts a run with the meeting as inputs
        │
        ▼  the agent's own workflow, e.g.:
start(meeting_id…) → meeting.transcribe → llm "summary + action items" → notion.create_page / slack.post_message
```

### The trigger

- Stored per agent in `agent_settings` (key `meeting_trigger`, `{ "enabled": true }`): no new
  table, nothing to migrate, deleted with the agent. Set from the Schedule screen; saved with
  *Activate agent* (works with "By hand" too).
- Only **tested or active** agents run (a draft has never run; a paused agent is paused).
- With no such agent, detection stays quiet: there would be nobody to take the notes.
- The run is started like a manual run (`RunTrigger::Manual`, the user pressed Take notes
  and Stop). A dedicated `meeting` trigger value needs a table rebuild of `runs` (its CHECK
  constraint) and can come later if the Runs list should tell them apart.
- Run inputs: `meeting_id`, `meeting_title` ("Zoom meeting, Nov 26 14:05"), `meeting_app`,
  `started_at`, `ended_at` (RFC 3339), `duration_minutes`. The workflow's `start` node
  declares the ones it uses.

### The `meeting.transcribe` step

```yaml
- id: transcribe
  type: meeting.transcribe
  title: Transcribe the meeting
  meeting_id: "{{#start.meeting_id#}}"
  language: auto            # or en, id, …
  timeout_ms: 1800000       # the default step limit (Settings, 2 min) is too short for a long meeting
```

Outputs `text` (one `[00:01:05] You: …` / `Others: …` paragraph per turn), `lines`
(`{start_ms, end_ms, speaker, text}`) and `title`. Registered in `flow::builtin_node_registry`
(`meeting::node`), so validation, the Nodes view and the builder see it like any built-in.
graphrt's node factories get no app state, so the step calls the app's `MeetingService`
through a host installed once at start-up.

- whisper `base` on 8 threads runs at roughly 20–40× real time here, so an hour of audio
  needs a few minutes: the builder guide sets `timeout_ms: 1800000` on the step (graphrt's
  per-node time limit), since the app's default step limit is 2 minutes.
- Two agents on one meeting share one transcription (the second gets the saved transcript).
- A failed transcription keeps the audio and marks the meeting; the run fails with the
  reason (Problems shows it, *Retry* works).

### Transcription engine: whisper.cpp, on demand

- Not bundled. The first transcription downloads, into `<app data>/meetings/whisper/`:
  - `whisper-cli` (4 MB): whisper.cpp v1.9.6 has no Linux binaries, so graphrt builds it
    (static ggml, x86-64-v3, needs glibc ≥ 2.35, MIT license included) and publishes it on
    the `whisper-cpp-v1.9.6` **prerelease** of this repository (not an app release).
  - `ggml-base.bin` (148 MB, multilingual incl. Indonesian) from the model's Hugging Face
    repository.
- Both pinned by SHA-256 in `meeting::whisper_install`; only `huggingface.co` and
  `github.com` URLs are accepted; a mismatch is discarded. Settings shows "Downloading the
  speech model (147 MB)…" while it runs.
- A `whisper-cli` on PATH, or paths in the settings JSON (developer overrides, not in the
  UI), are used instead of downloading.
- **Silence detection (VAD)** before whisper: 30 ms frames, a frame is voiced when its RMS is
  3× the track's noise floor and above an absolute minimum; pauses < 300 ms are bridged.
  A track with < 1 s of speech is not transcribed, and whisper segments that do not overlap
  voiced audio are dropped. This removes whisper's invented lines on a silent mic track
  (seen in the first prototype).
- API engines (the Deepgram / AssemblyAI plugins) stay available as ordinary plugin steps
  for users who prefer them; `meeting.transcribe` may get an `engine:` option later.

### Recording (Linux)

Two `pw-record` processes, 16 kHz mono 16-bit WAV (what whisper reads):

- `mic.wav`: default source, stream `node.name=graphrt-meeting-mic`.
- `system.wav`: `stream.capture.sink=true` (`node.name=graphrt-meeting-system`), which
  WirePlumber links to the default sink's monitor: everything the others say.

Stop sends SIGINT so pw-record finishes the WAV header (SIGKILL after 5 s). Two tracks give
speaker separation for free (mic = "You", system = "Others"). A meeting left *recording*
when the app quit is marked *recorded* at the next start.

### Detection (Linux)

- `pw-dump` every 3 s: a mic user is a `Stream/Input/Audio` node linked from an
  `Audio/Source*` node (sink monitors do not count). Name / binary / PID from the node or its
  client. Our own `graphrt-meeting-*` streams and our PID are skipped. Plain PulseAudio
  systems would use `pactl list source-outputs` behind the same trait (this machine runs
  PipeWire without `pactl`).
- Known apps (Zoom, Teams, Slack, Discord, Webex, Skype) and browsers are named; volume
  meters (pavucontrol, GNOME volume control, EasyEffects…) are ignored.
- A Meet tab is not identifiable: Chrome's stream is "Google Chrome input" without the tab,
  and Wayland does not expose window titles. Later: match a `google-calendar` event happening
  now (title, attendees) to name the meeting.
- State machine (`meeting::detector`): Idle → Pending (5 s) → Prompted → Recording, or
  Dismissed until the mic is free; while recording, mic free for 10 s → "seems over", and
  20 s later it stops (≈30 s), unless *Keep recording* or the app returns.

### Verified on this machine (Ubuntu, GNOME Wayland, PipeWire 1.6.2)

Debug build, isolated profile, agent "Meeting transcript" (`start → meeting.transcribe → end`)
with the trigger on: a stream named "ZOOM VoiceEngine" on the mic → card → Take notes → speech
played to the speakers → Stop → run `manual / succeeded` in 7 s, including the first-use
download of `whisper-cli` (prerelease) and `ggml-base.bin` (Hugging Face), both SHA-256
checked. The silent mic track was skipped by the VAD, the audio deleted, run output:
`[00:00:00] Others: And so my fellow Americans, ask not what your country can do for you, …`.
The automatic stop was seen too: "The meeting seems over. Notes stop in 9 s." then stopped.

### Storage and retention

`<app data>/meetings/<id>/`: `meta.json` (title, app, times, status, runs it started),
`mic.wav`, `system.wav`, `transcript.json`, `transcript.md`. After a successful transcript the
audio is **deleted** unless *Keep meeting audio* is on; the transcript stays (the agents' runs
and outputs are where the user reads it). Not yet: deleting old untranscribed recordings and
old transcripts (follow the "Keep run history for" setting).

### Other operating systems

`meeting::platform` traits (`AudioActivityProbe`, `MeetingRecorder`, `RecordingSession`).
Everything above them (detector, trigger, step, VAD, store, UI) is shared.

- macOS: mic in use via CoreAudio (`kAudioDevicePropertyDeviceIsRunningSomewhere`, per
  process on 14.4+), system audio via a Core Audio process tap (14.2+) or ScreenCaptureKit;
  microphone + "screen & system audio recording" permissions; whisper-cli for arm64 published
  next to the Linux one.
- Windows: mic in use via the `CapabilityAccessManager\ConsentStore\microphone` registry or
  WASAPI sessions, system audio via WASAPI loopback; whisper.cpp ships Windows binaries.

Until then they report "not supported" and the Settings rows and the checkbox are hidden.

## Decisions (owner, 2026-11-26)

1. Auto-stop ~30 s after the meeting app releases the mic, with a cancellable notice. ✔
2. Detection off by default (opt-in). ✔
3. whisper.cpp downloaded on first use, not bundled (graphrt-built `whisper-cli` on a
   prerelease, model from Hugging Face). ✔
4. Audio deleted after the transcript; *Keep meeting audio* in Settings. ✔
5. A one-line consent reminder in the prompt. ✔
