import { callBackend, isDesktopApp, listenToBackend } from './client'
import type {
  AgentCollab,
  CollabStatus,
  CollabWorkspace,
  CollabWorkspaceDetail,
  InvitePreview,
  ServerCheck,
} from './collabTypes'

/**
 * Teams (see `src-tauri/src/collab`). Outside the desktop app (the browser preview) there is
 * no team server: everything reports "only on this computer".
 */

const COLLAB_CHANGED_EVENT = 'collab-changed'
const COLLAB_AGENT_EVENT = 'collab-agent'

const previewStatus: CollabStatus = { server: 'https://collab.graphrt.dev', defaultServer: 'https://collab.graphrt.dev', signedIn: false, account: null }
const localOnly: AgentCollab = { shared: false, link: null, connection: 'local', role: null, readOnly: false, people: [], message: null }

export function getCollabStatus(): Promise<CollabStatus> {
  return isDesktopApp() ? callBackend('collab_status') : Promise.resolve(previewStatus)
}

export function checkCollabServer(address: string): Promise<ServerCheck> {
  return callBackend('collab_check_server', { address })
}

export function setCollabServer(address: string): Promise<CollabStatus> {
  return callBackend('collab_set_server', { address })
}

export function signInToCollab(): Promise<CollabStatus> {
  return callBackend('collab_sign_in')
}

export function signOutOfCollab(): Promise<CollabStatus> {
  return callBackend('collab_sign_out')
}

export function previewInvite(link: string): Promise<InvitePreview> {
  return callBackend('collab_preview_invite', { link })
}

export function joinTeam(link: string, name: string | null): Promise<{ workspace: { id: string; name: string }; role: string }> {
  return callBackend('collab_join', { link, name })
}

export function listTeams(): Promise<{ workspaces: CollabWorkspace[]; mayCreate: boolean }> {
  return callBackend('collab_workspaces')
}

export function createTeam(name: string): Promise<CollabWorkspace> {
  return callBackend('collab_create_workspace', { name })
}

export function getTeam(workspaceId: string): Promise<CollabWorkspaceDetail> {
  return callBackend('collab_workspace', { workspaceId })
}

export function createInvite(workspaceId: string, role: 'viewer' | 'operator'): Promise<{ link: string; expires_ms: number }> {
  return callBackend('collab_invite', { workspaceId, role })
}

export function setTeamMember(workspaceId: string, accountId: string, role: string | null): Promise<unknown> {
  return callBackend('collab_set_member', { workspaceId, accountId, role })
}

export function shareAgent(agentId: string, workspaceId: string): Promise<AgentCollab> {
  return callBackend('collab_share_agent', { agentId, workspaceId })
}

/** Opens a team's agent on this computer. @returns The local agent's id */
export function openTeamAgent(workspaceId: string, projectId: string): Promise<string> {
  return callBackend('collab_open_project', { workspaceId, projectId })
}

export function stopSharingAgent(agentId: string): Promise<AgentCollab> {
  return callBackend('collab_stop_sharing', { agentId })
}

export function getAgentCollab(agentId: string): Promise<AgentCollab> {
  return isDesktopApp() ? callBackend('collab_agent', { agentId }) : Promise.resolve(localOnly)
}

export function setAgentFocus(agentId: string, nodeId: string | null): Promise<void> {
  return isDesktopApp() ? callBackend('collab_set_focus', { agentId, nodeId }) : Promise.resolve()
}

/**
 * Calls `onChange(agentId)` when others changed a shared agent (reload it).
 *
 * @returns A function that stops listening
 */
export async function onSharedAgentChanged(onChange: (agentId: string) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => undefined
  return listenToBackend<{ agentId: string }>(COLLAB_CHANGED_EVENT, (payload) => onChange(payload.agentId))
}

/**
 * Calls `onChange(agentId)` when the sharing state of an agent changed (connection, people).
 *
 * @returns A function that stops listening
 */
export async function onAgentCollabChanged(onChange: (agentId: string) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => undefined
  return listenToBackend<{ agentId: string }>(COLLAB_AGENT_EVENT, (payload) => onChange(payload.agentId))
}
