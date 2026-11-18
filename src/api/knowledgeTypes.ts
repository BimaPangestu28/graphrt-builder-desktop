/**
 * Knowledge base types, mirroring `src-tauri/src/knowledge/models.rs` and
 * `knowledge/events.rs` (serialized camelCase; enums are snake_case strings).
 */

/** Where a source comes from: one file, every supported file of a folder, or a web link. */
export type KnowledgeSourceKind = 'file' | 'folder' | 'url'

/** Indexing state of one source. */
export type KnowledgeSourceStatus = 'pending' | 'reading' | 'indexed' | 'failed'

/** `local`: offline embeddings plus keyword search. `openai`: text-embedding-3-small with the OpenAI key. */
export type EmbeddingChoice = 'local' | 'openai'

export type KnowledgeBaseStatus = 'empty' | 'syncing' | 'up_to_date' | 'needs_attention'

export interface KnowledgeSettings {
  embedding: EmbeddingChoice
  /** 1 to 20 passages given to an agent per question. */
  passagesPerAnswer: number
  /** Passages scoring below this (0 to 1) are not given to agents. */
  minScore: number
  showSources: boolean
}

export interface SyncProgress {
  /** Sources finished in the running sync. */
  done: number
  total: number
}

export interface KnowledgeUsage {
  agentId: string
  agentName: string
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  settings: KnowledgeSettings
  status: KnowledgeBaseStatus
  syncProgress: SyncProgress | null
  sourceCount: number
  /** Files indexed from file and folder sources. */
  fileCount: number
  websiteCount: number
  passageCount: number
  storageBytes: number
  usedBy: KnowledgeUsage[]
  /** RFC 3339. */
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeSource {
  id: string
  knowledgeBaseId: string
  kind: KnowledgeSourceKind
  /** Absolute path or URL. */
  location: string
  name: string
  status: KnowledgeSourceStatus
  /** Why the source failed, or which of its files could not be read. */
  statusMessage: string | null
  documentCount: number
  failedCount: number
  passageCount: number
  lastSyncedAt: string | null
  createdAt: string
}

export interface KnowledgeBaseDetail {
  knowledgeBase: KnowledgeBase
  sources: KnowledgeSource[]
}

/** One search result. */
export interface KnowledgePassage {
  id: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  sourceId: string | null
  sourceName: string
  /** Section heading ("Menu > Delivery") or "Passage 3". */
  location: string | null
  text: string
  /** 0 to 1, higher is better. */
  score: number
}

/** Payload of the `knowledge-event` backend event. */
export type KnowledgeEvent =
  | { type: 'sync_started'; knowledgeBaseId: string }
  | { type: 'source_updated'; knowledgeBaseId: string; source: KnowledgeSource; progressPercent: number | null }
  | { type: 'sync_finished'; knowledgeBaseId: string; knowledgeBase: KnowledgeBase }
