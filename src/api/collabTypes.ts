/** Teams (see `src-tauri/src/collab`): the team server, sign in, sharing an agent. */

export interface CollabAccount {
  id: string
  name: string
  email?: string | null
  color: string
}

export interface CollabStatus {
  server: string
  defaultServer: string
  signedIn: boolean
  account: CollabAccount | null
}

export type ServerProblem = 'address' | 'plain_http' | 'unreachable' | 'tls' | 'not_collab' | 'http'

export interface ServerCheck {
  server: string
  ok: boolean
  problem: ServerProblem | null
  detail: string | null
  signInWithBrowser: boolean
  signInWithInvite: boolean
  /** One sign in button each (e.g. Google and Microsoft). Empty: one "Sign in" button. */
  signInProviders: SignInChoice[]
  mode: string | null
}

/** An identity provider of the server. */
export interface SignInChoice {
  id: string
  name: string
}

/** `viewer`, `operator` (can edit) or `owner`. */
export type CollabRole = 'viewer' | 'operator' | 'owner'

export interface CollabWorkspace {
  id: string
  name: string
  role: CollabRole
  members: number
  projects: number
}

export interface CollabPerson {
  id: string
  name: string
  color: string
  role?: string
  email?: string | null
  focus?: string | null
}

export interface CollabMember extends CollabPerson {
  role: CollabRole
}

export interface CollabProject {
  id: string
  name: string
  updated_ms: number
  online: CollabPerson[]
}

export interface CollabWorkspaceDetail extends CollabWorkspace {
  members_list: CollabMember[]
  projects_list: CollabProject[]
}

export interface CollabLink {
  server: string
  workspaceId: string
  workspaceName: string
  projectId: string
}

export type CollabConnection = 'local' | 'connecting' | 'connected' | 'offline' | 'signed_out' | 'removed' | 'other_server'

export interface AgentCollab {
  shared: boolean
  link: CollabLink | null
  connection: CollabConnection
  role: CollabRole | null
  readOnly: boolean
  people: CollabPerson[]
  message: string | null
}

export interface InvitePreview {
  server: string
  workspace: { id: string; name: string }
  role: CollabRole
  invited_by: string | null
  needs_sign_in: boolean
}
