# Teams: building agents together

Share an agent with a team and everyone in it can open it and work on it with you, live.
The app talks to a **team server** (`graphrt collab`): Graphrt's hosted server by default, or
your company's own (see [docs/collab.md](https://github.com/Graphrt/graphrt/blob/main/docs/collab.md)
in Graphrt/graphrt for running one).

Without a team server nothing changes: no account, no network call, agents stay on this computer.

## Settings > Team server

- **Server address**: Graphrt's server, or the address your IT team gives you
  (`https://collab.example.com`, a port if needed: `https://collab.example.com:8443`).
  Plain `http://` is refused except for `localhost`.
- **Check connection** says what is wrong in plain words: not an address, plain http, the server
  does not answer, the certificate is not valid, not a team server, an error.
- **Sign in** opens the browser to sign in with your work account (the server's identity provider).
  The app waits on a local address for the browser to come back and never sees your password.
  Servers without an identity provider let people in with an invite link instead.
- The sign in is kept in the system's credential store (Keychain, Credential Manager, Secret
  Service), per server. Changing servers keeps every local agent; agents shared on another
  server pause until you switch back.

## Sharing an agent

- **Share** (next to the agent's name) > pick a team or create one > **Share with ...**.
  The agent stays on this computer and becomes a shared agent of the team.
- **Invite people**: a link to view or to edit (team owners). Anyone with the link joins the team.
- **Join a team**: paste an invite link (Share > Join a team). A link of another server switches to it.
- **Agents of the team**: open an agent someone else shared; it becomes a local agent kept in sync.
- **Avatars** show who else is in the agent, and the line next to them the connection
  (live, connecting, offline, sign in needed).
- **View only**: someone invited to view sees every change live, and a change they make is put back.
- **Stop sharing on this computer** keeps the agent here as a local agent (the team keeps its copy).

## How edits merge

Each agent stays an ordinary local agent: every screen keeps working. The app compares the
agent with the shared one a few times a second and sends only what changed here since both
sides last agreed (a three way merge), and writes what others changed as a new version
("Edited by <names>") so the version history shows it. The shared document merges edits of
different steps, of the same prompt (character by character) and of the layout without
conflicts. When the same setting is changed on two computers at once, one value wins, the
same on both.

Offline, the shared document is kept with the agent and what you change is sent and merged
when the server is back.

## Under the hood

- `src-tauri/src/collab/`: the service (server, sign in, teams, sharing), `session.rs` (the live
  session of one agent), `merge.rs` (the three way merge), `tests.rs` (several app instances
  against a real team server: concurrent edits, offline edits, the viewer, an outsider).
- `src/pages/settings/TeamServerSection.tsx`, `src/pages/agent-builder/ShareControl.tsx`.
- The client is `graphrt-collab` (feature `client`) of Graphrt/graphrt.
