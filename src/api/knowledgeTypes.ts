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

/**
 * One place where a document may be cut, tried in order (`src-tauri/src/knowledge/chunking.rs`).
 * `text` splits after each occurrence (`\n` and `\t` typed literally mean a line break and a tab);
 * `pattern` is a regular expression and splits before each match.
 */
export type SeparatorSetting =
  | { kind: 'paragraph' }
  | { kind: 'line' }
  | { kind: 'sentence' }
  | { kind: 'clause' }
  | { kind: 'word' }
  | { kind: 'text'; value: string }
  | { kind: 'pattern'; value: string }

export type SeparatorKind = SeparatorSetting['kind']

/** How documents are cut into passages. Sizes are tokens (about 4 characters each). */
export interface ChunkingSettings {
  /** 50 to 2000. */
  maxTokens: number
  /** At most half of `maxTokens`. */
  overlapTokens: number
  /** 0 (off) to `maxTokens`: shorter pieces are joined with a neighbour when they fit. */
  minTokens: number
  /** Coarse to fine, at most 12. Cutting inside a word is always the last resort. */
  separators: SeparatorSetting[]
  respectHeadings: boolean
  /** Never let a passage span two PDF pages. */
  splitPages: boolean
}

export interface KnowledgeSettings {
  embedding: EmbeddingChoice
  /** 1 to 20 passages given to an agent per question. */
  passagesPerAnswer: number
  /** Passages scoring below this (0 to 1) are not given to agents. */
  minScore: number
  showSources: boolean
  /** Takes effect when the knowledge base is indexed again. */
  chunking: ChunkingSettings
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
  /** Some documents were indexed with other chunking settings: indexing again applies them. */
  needsReindex: boolean
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
  /** Set for sources that sync from a web site, an API, Google Drive, Notion or SharePoint. */
  connector?: ConnectorView | null
}

export interface KnowledgeBaseDetail {
  knowledgeBase: KnowledgeBase
  sources: KnowledgeSource[]
}

/** One indexed document of a source: the file itself, or one file of a folder. */
export interface KnowledgeDocument {
  sourceId: string
  documentId: string
  name: string
  passageCount: number
  /** RFC 3339; null for documents indexed by older versions. */
  indexedAt: string | null
  needsReindex: boolean
}

/** One passage of a document. */
export interface KnowledgeChunk {
  id: string
  /** Position in the document, from 0. */
  index: number
  text: string
  charCount: number
  /** Estimated, about 4 characters per token. */
  tokenCount: number
  /** Character range of the passage's own text (without the repeated overlap); null when unknown. */
  charStart: number | null
  charEnd: number | null
  heading: string | null
  /** PDF pages, ascending; empty when unknown. */
  pages: number[]
}

/** One page of a document's passages, in document order. */
export interface KnowledgeChunkPage {
  document: KnowledgeDocument
  total: number
  /** Passages matching the filter (equal to `total` without one). */
  matching: number
  offset: number
  chunks: KnowledgeChunk[]
  totalChars: number
  totalTokens: number
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
  /** Position of the passage in its document, from 0, when known. */
  chunkIndex: number | null
  /** First PDF page, when known. */
  page: number | null
  text: string
  /** 0 to 1, higher is better. */
  score: number
}

/** Payload of the `knowledge-event` backend event. */
export type KnowledgeEvent =
  | { type: 'sync_started'; knowledgeBaseId: string }
  | { type: 'source_updated'; knowledgeBaseId: string; source: KnowledgeSource; progressPercent: number | null }
  | { type: 'sync_finished'; knowledgeBaseId: string; knowledgeBase: KnowledgeBase }

/** Where a connector source syncs from (`knowledge/connectors.rs`). */
export type ConnectorKind = 'website' | 'api' | 'google_drive' | 'notion' | 'sharepoint'

/** Who Drive and SharePoint sources sign in with. */
export type OAuthProvider = 'google' | 'microsoft'

/**
 * When a source syncs by itself (graphrt-connect's form): `manual`, `{ every: '6h' }`,
 * `{ daily: '06:00', timezone: '+07:00' }` or `{ cron: '0 * * * *', timezone: 'UTC' }`.
 */
export type SyncSchedule =
  | 'manual'
  | { every: string }
  | { daily: string; timezone: string }
  | { cron: string; timezone: string }

/** How a connector source signs in, as stored (no secret). */
export type ConnectorAuth =
  | { type: 'none' }
  | { type: 'token' }
  | { type: 'api_key'; header: string }
  | { type: 'basic'; username: string }
  | { type: 'oauth'; provider: OAuthProvider; clientId: string; hasClientSecret: boolean }

/** How a new connector source signs in; secrets go to the keychain and never come back. */
export type ConnectorAuthInput =
  | { type: 'none' }
  | { type: 'token'; token: string }
  | { type: 'api_key'; header: string; value: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'oauth'; signInId: string }

export interface ConnectorView {
  kind: ConnectorKind
  /** Connector settings (`urls`, `folder_id`, `page_ids`, ...), snake_case as graphrt-connect reads them. */
  options: Record<string, unknown>
  auth: ConnectorAuth
  schedule: SyncSchedule
  /** RFC 3339; null for manual sources. */
  nextSyncAt: string | null
  accountLabel: string | null
  /** Stable kind of the last sync error (`auth`, `not_found`, `denied`, `busy`, ...). */
  lastErrorKind: string | null
}

export interface NewConnectorSource {
  kind: ConnectorKind
  name: string
  options: Record<string, unknown>
  auth: ConnectorAuthInput
  schedule: SyncSchedule
}

/** Whether the app has its own sign-in registration for a provider. */
export interface ConnectorSignInSetup {
  provider: OAuthProvider
  hasBuiltInClient: boolean
  redirectUri: string
  scopes: string
}

export interface ConnectorSignInResult {
  signInId: string
  accountLabel: string | null
}
