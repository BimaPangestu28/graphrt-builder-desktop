# Meeting notetaker (local, Linux first)

Status: prototype (Linux / PipeWire). macOS and Windows follow behind the same traits.

graphrt Desktop notices that a meeting started on this computer, **asks** whether to take
notes, records the user's microphone and the computer's sound as two separate tracks, and
turns them into a transcript (and later a summary sent to Notion / Slack / email). No bot
joins the call and no Zoom / Meet / Teams API is used: everything is observed from the
laptop itself, like Granola.

## Principles

- **Never record on its own.** Detection only offers ("Meeting detected, take notes?").
  Recording starts when the user clicks *Take notes* (or *Start recording* on the Meetings
  page), and a red "Recording" pill with a *Stop* button stays on every screen while it runs.
- **Local by default.** Audio, transcripts and summaries live in the app data folder
  (`<app data>/meetings/<id>/`). Nothing leaves the computer unless the user chooses an API
  transcriber or sends the notes to a plugin.
- **Detection is off until the user turns it on** (Meetings page). Manual recording works
  without it.

## Pieces

```
src-tauri/src/meeting/
  mod.rs          MeetingService: poll loop, prompt/recording state, commands' logic
  platform.rs     traits per OS: AudioActivityProbe, MeetingRecorder, RecordingSession
  apps.rs         which program is it (Zoom, Teams, browser…), volume meters to ignore
  detector.rs     detection state machine (pure, unit tested)
  store.rs        meetings on disk: meta.json, tracks, transcript files
  transcript.rs   Transcriber trait, whisper.cpp JSON parsing, merging the two tracks
  settings.rs     detection on/off, transcriber paths (one JSON value in the settings table)
  linux/          PipeWire: pw-dump parser (mic users) and pw-record recorder
src-tauri/src/commands/meetings.rs   Tauri commands
src/api/meetings*.ts, src/pages/MeetingsPage.tsx, src/pages/meetings/*   UI
```

### 1. Detection

Signal, strongest first:

1. **Another program captures the microphone.** On PipeWire, `pw-dump` lists every node,
   client and link. A *mic user* is a `Stream/Input/Audio` node with a link coming from an
   `Audio/Source*` node (a real microphone; sink monitors are `Audio/Sink` and do not count).
   Program name, binary and PID come from the node or, when the node lacks them, from its
   client (`client.id`). Our own recorder streams are named `graphrt-meeting-*` and skipped,
   as is our own PID. On plain PulseAudio the same data is `pactl list source-outputs`; this
   machine runs PipeWire without `pactl`, so the prototype reads `pw-dump` (pipewire-pulse
   keeps working for apps either way).
2. **Which program.** `apps.rs` maps binary / application name to a known meeting app
   (zoom, teams / teams-for-linux, slack, discord, webex, skype) or a browser (chrome,
   chromium, firefox, brave, edge, vivaldi). Volume meters and audio tools (pavucontrol,
   GNOME volume control, easyeffects, wireplumber) are ignored.
3. **Browser tab (Meet).** Not reliable on Linux: Chrome's capture stream is named
   "Google Chrome input" with no tab title, and Wayland gives no window titles to other
   apps (GNOME would need a shell extension). The prompt therefore says "Google Chrome is
   using the microphone". A later option is a small browser extension, or matching with
   the calendar (below).
4. **Calendar (optional, later).** With the `google-calendar` plugin installed, an event
   happening now (or starting within 5 minutes) that has a conference link names the
   meeting ("Weekly sync with Acme") and gives attendees for the summary. It only enriches
   the prompt; it never starts recording.

State machine (`detector.rs`), fed every 3 s with the current mic users:

```
Idle ──mic used──▶ Pending ──still used after 5 s──▶ Prompted ──Take notes──▶ Recording
  ▲                  │ mic free                         │ Not now                │
  │                  ▼                                  ▼                        │ mic free 15 s
  └──────────────── Idle ◀──mic free 15 s──────── Dismissed                      ▼
                                                                         MeetingEnded (once):
                                                                         "Meeting seems over, stop?"
```

- *Pending* filters a quick mic check or a voice message.
- *Dismissed* stays quiet until the mic is free for 15 s, so the same meeting is not
  offered again.
- After *Stop*, a meeting still holding the mic goes to *Dismissed* (not offered again).
- While recording, the mic going free for 15 s raises "Meeting seems over" once.
  Auto-stop is an owner decision (see below); the prototype only asks.

### 2. UX

- System notification: "Meeting detected: Zoom is using the microphone. Take notes?"
  Clicking it shows the window. Desktop notifications on Linux cannot carry reliable action
  buttons through tauri-plugin-notification, so the choice is in the app: a card at the
  bottom right of every screen with **Take notes** / **Not now**.
- While recording: a red pill "● Recording 12:34 · Stop" at the bottom right of every
  screen, plus the Meetings page header.
- Meetings page: detection switch, who uses the mic now, Start / Stop, past meetings with
  their tracks, *Transcribe* and the transcript.

### 3. Recording

Two tracks, 16 kHz mono 16-bit WAV (what whisper wants, ~1.9 MB per minute per track):

- `mic.wav`: `pw-record -P '{ node.name=graphrt-meeting-mic }' --rate 16000 --channels 1 --format s16`
  on the default source.
- `system.wav`: same with `stream.capture.sink=true` (and `node.name=graphrt-meeting-system`),
  which WirePlumber links to the default sink's monitor: everything the other people say.

Stop sends SIGINT so pw-record finalizes the WAV header, then waits (SIGKILL after 5 s).
Two separate tracks give speaker separation for free: mic = "You", system = "Others".
A meeting left in *recording* when the app quit is marked *recorded* on the next start.

Later: Opus/FLAC compression after the meeting, echo cancellation when the user has no
headphones (the mic track then also contains the other side; PipeWire's
`module-echo-cancel` or deduplicating segments that appear in both tracks).

### 4. Transcription

`Transcriber` trait, one implementation per engine, each track transcribed on its own and
merged by start time into `transcript.json` (segments) and `transcript.md`:

```
[00:00:03] You: Okay, let's start with the launch plan.
[00:00:07] Others: Sounds good, I have the numbers.
```

- **Local: whisper.cpp** (prototype). The `whisper-cli` binary plus a ggml model
  (`ggml-base.bin`, 148 MB, multilingual incl. Indonesian), run as a child process with
  `-oj` (JSON segments). Paths are set on the Meetings page or found automatically
  (`whisper-cli` on PATH, `<app data>/meetings/models/ggml-*.bin`). Later: bundle via
  `whisper-rs` (needs cmake in the release builders) or download binary + model on demand,
  like the Node runtime.
  Seen in the prototype: on a near-silent mic track whisper `base` invents a line
  ("ndoong sotali…"); next step is skipping silent stretches (whisper.cpp's Silero VAD,
  `--vad`) and dropping low-confidence segments.
- **API: Deepgram / AssemblyAI plugins** (next). Through `PluginService::run_action`:
  `deepgram.transcribe_file` (needs the plugin's `DEEPGRAM_UPLOAD_DIR` to cover the meetings
  folder) or `assemblyai.upload_file` + `assemblyai.transcribe`. Same `Transcriber` trait,
  same merge.

### 5. Summary and delivery (next)

After the transcript, "Send to…" starts a graphrt agent run with inputs
`{ title, started_at, attendees, transcript }`. A template agent "Meeting notes" does:
LLM summary (decisions, action items, owners) → Notion page / Slack message / email via
the existing plugins. Using a normal agent keeps model choice, approvals, retries and run
history as they are, and lets users change the destination in the builder.

### 6. Other operating systems

`platform.rs` traits:

```rust
trait AudioActivityProbe { fn mic_users(&self) -> BoxFuture<Result<Vec<MicUser>, MeetingError>>; }
trait MeetingRecorder     { fn start(&self, dir: &Path) -> BoxFuture<Result<Box<dyn RecordingSession>, MeetingError>>; }
trait RecordingSession    { fn tracks(&self) -> Vec<TrackInfo>; fn stop(self: Box<Self>) -> BoxFuture<Result<(), MeetingError>>; }
```

- macOS: mic in use via CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` (per process
  on 14.4+ with `kAudioHardwarePropertyProcessObjectList`), system audio via a Core Audio
  process tap (14.2+) or ScreenCaptureKit; needs the microphone + "screen & system audio
  recording" permissions.
- Windows: mic in use via the `CapabilityAccessManager\ConsentStore\microphone` registry
  (`LastUsedTimeStop == 0`) or WASAPI session enumeration, system audio via WASAPI loopback.

Everything above the traits (detector, store, transcript merge, UI) is shared.

## Prototype scope (this PR)

- Linux probe (`pw-dump`) and recorder (`pw-record`), detector, notification + in-app prompt,
  recording pill with Stop, Meetings page, local whisper.cpp transcription end to end.
- Not yet: API transcribers, calendar matching, summary/delivery, compression, echo
  cancellation, macOS/Windows backends (they report "not supported on this system").

## Decisions for the owner

1. Auto-stop when the meeting app releases the mic, or keep asking? (prototype: ask)
2. Detection on by default after install, or opt-in? (prototype: opt-in)
3. Local whisper distribution: bundle `whisper-rs` (bigger app, cmake in builders) vs.
   download `whisper-cli` + model on demand vs. API-only by default.
4. Retention: keep audio after a transcript exists, or delete it after N days?
5. Consent: show a reminder to tell other participants that notes are being taken
   (recording laws differ by country)?
