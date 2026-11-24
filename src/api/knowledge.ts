import { callBackend, isDesktopApp, listenToBackend } from './client'
import { sampleKnowledgeBackend } from './sampleBackend/knowledge'
import type {
  KnowledgeBase,
  KnowledgeBaseDetail,
  KnowledgeEvent,
  KnowledgePassage,
  KnowledgeSettings,
  KnowledgeSource,
  KnowledgeSourceKind,
} from './knowledgeTypes'

/**
 * Knowledge bases (screens 17 and 18). Indexing runs in the background: adding a
 * source or syncing returns at once and progress arrives through
 * {@link subscribeToKnowledgeEvents}.
 */

/** Backend event carrying {@link KnowledgeEvent}. */
export const KNOWLEDGE_EVENT = 'knowledge-event'

/** File types the backend can read, for the file picker filter. */
export const SUPPORTED_KNOWLEDGE_EXTENSIONS = [
  'pdf', 'docx', 'pptx', 'xlsx', 'ods', 'csv', 'tsv', 'md', 'markdown', 'txt', 'text',
  'html', 'htm', 'json', 'yaml', 'yml', 'xml', 'epub', 'eml', 'srt', 'vtt',
] as const

export function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.listKnowledgeBases()
  return callBackend('list_knowledge_bases')
}

export function getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseDetail> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.getKnowledgeBase(knowledgeBaseId)
  return callBackend('get_knowledge_base', { knowledgeBaseId })
}

export function createKnowledgeBase(name: string, description = ''): Promise<KnowledgeBase> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.createKnowledgeBase(name, description)
  return callBackend('create_knowledge_base', { name, description })
}

export function renameKnowledgeBase(knowledgeBaseId: string, name: string): Promise<KnowledgeBase> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.renameKnowledgeBase(knowledgeBaseId, name)
  return callBackend('rename_knowledge_base', { knowledgeBaseId, name })
}

export function deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.deleteKnowledgeBase(knowledgeBaseId)
  return callBackend('delete_knowledge_base', { knowledgeBaseId })
}

/**
 * Adds a file, folder (absolute paths from the picker) or http(s) link and starts indexing it.
 *
 * @throws BackendError - `invalid_input` for an unreadable type, a missing path or a duplicate
 */
export function addKnowledgeSource(knowledgeBaseId: string, kind: KnowledgeSourceKind, location: string): Promise<KnowledgeSource> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.addKnowledgeSource(knowledgeBaseId, kind, location)
  return callBackend('add_knowledge_source', { knowledgeBaseId, kind, location })
}

export function removeKnowledgeSource(sourceId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.removeKnowledgeSource(sourceId)
  return callBackend('remove_knowledge_source', { sourceId })
}

/** Re-reads every source in the background; unchanged files are skipped. */
export function syncKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.syncKnowledgeBase(knowledgeBaseId)
  return callBackend('sync_knowledge_base', { knowledgeBaseId })
}

/** Saves settings. A different embedding model re-indexes the knowledge base in the background. */
export function updateKnowledgeSettings(knowledgeBaseId: string, settings: KnowledgeSettings): Promise<KnowledgeBase> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.updateKnowledgeSettings(knowledgeBaseId, settings)
  return callBackend('update_knowledge_settings', { knowledgeBaseId, settings })
}

/**
 * Searches knowledge the way an agent would, best match first.
 *
 * @param query - The question
 * @param knowledgeBaseIds - Limit to these knowledge bases; all when omitted
 * @param limit - Most passages to return (1 to 50)
 */
export function searchKnowledge(query: string, knowledgeBaseIds?: string[], limit = 8): Promise<KnowledgePassage[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.searchKnowledge(query, knowledgeBaseIds, limit)
  return callBackend('search_knowledge', { query, knowledgeBaseIds: knowledgeBaseIds ?? null, limit })
}

/** Listens to sync progress. Returns an unsubscribe function. */
export function subscribeToKnowledgeEvents(onKnowledgeEvent: (event: KnowledgeEvent) => void): Promise<() => void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleKnowledgeBackend.subscribeToKnowledgeEvents(onKnowledgeEvent)
  return listenToBackend(KNOWLEDGE_EVENT, onKnowledgeEvent)
}

/**
 * Opens the system picker for documents (desktop only).
 *
 * @returns Absolute paths, empty when the picker was closed
 */
export async function pickKnowledgeFiles(title: string): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    title,
    multiple: true,
    filters: [{ name: 'Documents', extensions: [...SUPPORTED_KNOWLEDGE_EXTENSIONS] }],
  })
  if (!picked) return []
  return Array.isArray(picked) ? picked : [picked]
}

/**
 * Opens the system picker for one folder (desktop only).
 *
 * @returns The absolute path, or null when the picker was closed
 */
export async function pickKnowledgeFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ title, directory: true, multiple: false, recursive: true })
  return typeof picked === 'string' ? picked : null
}

/** True for text that looks like an http(s) link. */
export function isWebLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}
