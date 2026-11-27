import { callBackend, isDesktopApp } from './client'
import { sampleKnowledgeConnectorBackend } from './sampleBackend/knowledgeConnectors'
import type {
  ConnectorSignInResult,
  ConnectorSignInSetup,
  KnowledgeSource,
  NewConnectorSource,
  OAuthProvider,
  SyncSchedule,
} from './knowledgeTypes'

/**
 * Knowledge sources that sync from a web site, an API, Google Drive, Notion or
 * SharePoint (screen 18). Adding one starts its first sync in the background;
 * progress arrives as `knowledge-event`s like any other source.
 */

export function addConnectorSource(knowledgeBaseId: string, source: NewConnectorSource): Promise<KnowledgeSource> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeConnectorBackend.addConnectorSource(knowledgeBaseId, source)
  return callBackend('add_knowledge_connector_source', { knowledgeBaseId, source })
}

export function setSourceSchedule(sourceId: string, schedule: SyncSchedule): Promise<KnowledgeSource> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeConnectorBackend.setSourceSchedule(sourceId, schedule)
  return callBackend('set_knowledge_source_schedule', { sourceId, schedule })
}

/** "Sync now" on one source. */
export function syncKnowledgeSource(sourceId: string): Promise<KnowledgeSource> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeConnectorBackend.syncKnowledgeSource(sourceId)
  return callBackend('sync_knowledge_source', { sourceId })
}

export function connectorSignInSetup(provider: OAuthProvider): Promise<ConnectorSignInSetup> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeConnectorBackend.connectorSignInSetup(provider)
  return callBackend('knowledge_connector_sign_in_setup', { provider })
}

/** Opens the browser to sign in (read only access); resolves when the sign-in is done. */
export function signInConnector(provider: OAuthProvider, client?: { clientId?: string; clientSecret?: string }): Promise<ConnectorSignInResult> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeConnectorBackend.signInConnector(provider)
  return callBackend('sign_in_knowledge_connector', { provider, client: client ?? null })
}

/** The time zone of this computer as a fixed offset (`+07:00`), for daily schedules. */
export function localUtcOffset(now = new Date()): string {
  const minutes = -now.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(minutes)
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

/** A Google Drive folder or file id from a link (`.../folders/<id>`, `?id=<id>`) or the id itself. */
export function driveIdFromLink(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fromPath = trimmed.match(/\/(?:folders|d)\/([A-Za-z0-9_-]{10,})/)
  if (fromPath) return fromPath[1]
  const fromQuery = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (fromQuery) return fromQuery[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) || trimmed === 'root' ? trimmed : null
}
