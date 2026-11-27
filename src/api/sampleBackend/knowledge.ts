import { BackendError } from '../client'
import type {
  ChunkingSettings,
  KnowledgeBase,
  KnowledgeBaseDetail,
  KnowledgeChunk,
  KnowledgeChunkPage,
  KnowledgeDocument,
  KnowledgeEvent,
  KnowledgePassage,
  KnowledgeSettings,
  KnowledgeSource,
  KnowledgeSourceKind,
} from '../knowledgeTypes'
import { knowledgePassages, searchKnowledgePassages, type KnowledgePassage as SamplePassage } from '@/api/sampleBackend/fixtures/knowledgePassages'
import { requireText, respondWith } from './sampleResponse'
import { seedConnectorSources } from './knowledgeConnectorSeeds'

/**
 * Sample knowledge bases for the browser preview and tests, kept in memory and
 * seeded from the mock data of screens 17 and 18 (`fixtures/knowledgePassages.ts`).
 *
 * Added sources pretend to index: they turn `reading` at once and `indexed`
 * after {@link SAMPLE_INDEXING_DELAY_MS}, with `knowledge-event`s like the real
 * backend. Call {@link resetSampleKnowledge} in tests to start from the seed.
 */

export const SAMPLE_INDEXING_DELAY_MS = 800
const sampleKnowledgeBaseId = 'menu-and-prices'
/** A sample knowledge base filled by connectors (Notion, a crawled site, Google Drive). */
export const sampleConnectedKnowledgeBaseId = 'team-wiki'
const sampleFolder = '/Users/you/Documents'
const seedCreatedAt = '2026-10-01T02:00:00Z'
/** 13:02 on the sample day in the viewer's time zone, as on the mockup. */
const seedLastSyncedAt = new Date(2026, 10, 18, 13, 2).toISOString()

function defaultChunking(): ChunkingSettings {
  return {
    maxTokens: 250,
    overlapTokens: 25,
    minTokens: 0,
    separators: [{ kind: 'paragraph' }, { kind: 'line' }, { kind: 'sentence' }, { kind: 'clause' }, { kind: 'word' }],
    respectHeadings: true,
    splitPages: false,
  }
}

const defaultSettings: KnowledgeSettings = { embedding: 'local', passagesPerAnswer: 4, minScore: 0.55, showSources: true, chunking: defaultChunking() }

function seedKnowledgeBase(fields: Partial<KnowledgeBase> & Pick<KnowledgeBase, 'id' | 'name'>): KnowledgeBase {
  return {
    description: '',
    settings: { ...defaultSettings, chunking: defaultChunking() },
    needsReindex: false,
    status: 'up_to_date',
    syncProgress: null,
    sourceCount: 1,
    fileCount: 0,
    websiteCount: 0,
    passageCount: 0,
    storageBytes: 0,
    usedBy: [],
    lastSyncedAt: seedLastSyncedAt,
    createdAt: seedCreatedAt,
    updatedAt: seedCreatedAt,
    ...fields,
  }
}

function seedSource(fields: Partial<KnowledgeSource> & Pick<KnowledgeSource, 'id' | 'name' | 'knowledgeBaseId'>): KnowledgeSource {
  return {
    kind: 'file',
    location: `${sampleFolder}/${fields.name}`,
    status: 'indexed',
    statusMessage: null,
    documentCount: 1,
    failedCount: 0,
    passageCount: 0,
    lastSyncedAt: seedLastSyncedAt,
    createdAt: seedCreatedAt,
    ...fields,
  }
}

function buildSeedKnowledgeBases(): KnowledgeBase[] {
  return [
    seedKnowledgeBase({
      id: sampleKnowledgeBaseId,
      name: 'Catering menu and prices',
      sourceCount: 4,
      fileCount: 3,
      websiteCount: 1,
      passageCount: 412,
      storageBytes: 9_400_000,
      usedBy: [
        { agentId: 'catering-assistant', agentName: 'Catering assistant' },
        { agentId: 'maps-leads', agentName: 'Maps leads to WhatsApp' },
      ],
    }),
    seedKnowledgeBase({
      id: 'company-documents',
      name: 'Company documents',
      status: 'syncing',
      syncProgress: { done: 16, total: 25 },
      fileCount: 138,
      passageCount: 2310,
      usedBy: [{ agentId: 'ask-documents', agentName: 'Ask your documents' }],
    }),
    seedKnowledgeBase({
      id: sampleConnectedKnowledgeBaseId,
      name: 'Team wiki and website',
      status: 'needs_attention',
      sourceCount: 3,
      fileCount: 51,
      passageCount: 429,
      storageBytes: 3_100_000,
      usedBy: [{ agentId: 'catering-assistant', agentName: 'Catering assistant' }],
    }),
    seedKnowledgeBase({
      id: 'past-orders',
      name: 'Past orders',
      fileCount: 1,
      passageCount: 96,
      usedBy: [{ agentId: 'catering-assistant', agentName: 'Catering assistant' }],
    }),
  ]
}

function buildSeedSources(): KnowledgeSource[] {
  const knowledgeBaseId = sampleKnowledgeBaseId
  return [
    seedSource({ id: 'menu-november', knowledgeBaseId, name: 'Menu November.pdf', passageCount: 186 }),
    seedSource({ id: 'price-list', knowledgeBaseId, name: 'Price list.xlsx', passageCount: 84 }),
    seedSource({ id: 'delivery-faq', knowledgeBaseId, name: 'Delivery and FAQ.md', passageCount: 58 }),
    seedSource({
      id: 'website',
      knowledgeBaseId,
      kind: 'url',
      name: '[YOUR WEBSITE]',
      location: 'https://example.com',
      documentCount: 6,
      failedCount: 1,
      statusMessage: '1 page failed',
      passageCount: 84,
    }),
    ...seedConnectorSources(sampleConnectedKnowledgeBaseId, seedLastSyncedAt),
    seedSource({ id: 'kantor-folder', knowledgeBaseId: 'company-documents', kind: 'folder', name: 'Kantor', location: `${sampleFolder}/Kantor`, documentCount: 138, status: 'reading', passageCount: 2310 }),
    seedSource({ id: 'orders-csv', knowledgeBaseId: 'past-orders', name: 'Orders.csv', passageCount: 96 }),
  ]
}

let storedKnowledgeBases: KnowledgeBase[] = []
let storedSources: KnowledgeSource[] = []
/** Chunking each knowledge base was last indexed with (JSON), by id; missing means the defaults. */
let indexedChunking = new Map<string, string>()
let createdCount = 0
const listeners = new Set<(event: KnowledgeEvent) => void>()
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

/** Puts the sample knowledge back to the seed and cancels pretend indexing. */
export function resetSampleKnowledge(): void {
  storedKnowledgeBases = buildSeedKnowledgeBases()
  storedSources = buildSeedSources()
  indexedChunking = new Map()
  createdCount = 0
  pendingTimers.forEach((timer) => clearTimeout(timer))
  pendingTimers.clear()
}

resetSampleKnowledge()

function emit(event: KnowledgeEvent): void {
  listeners.forEach((listener) => listener(event))
}

function findKnowledgeBase(knowledgeBaseId: string): KnowledgeBase {
  const knowledgeBase = storedKnowledgeBases.find((candidate) => candidate.id === knowledgeBaseId)
  if (!knowledgeBase) throw new BackendError('not_found', `knowledge base ${knowledgeBaseId} not found`)
  return knowledgeBase
}

function replaceKnowledgeBase(changed: KnowledgeBase): KnowledgeBase {
  storedKnowledgeBases = storedKnowledgeBases.map((knowledgeBase) => (knowledgeBase.id === changed.id ? changed : knowledgeBase))
  return { ...changed }
}

/** Recomputes the totals of a knowledge base from its sources (like the backend summary). */
function refreshTotals(knowledgeBaseId: string, isSyncing: boolean): KnowledgeBase {
  const knowledgeBase = findKnowledgeBase(knowledgeBaseId)
  const sources = storedSources.filter((source) => source.knowledgeBaseId === knowledgeBaseId)
  const needsAttention = sources.some((source) => source.status !== 'indexed' || source.failedCount > 0)
  const status = isSyncing ? 'syncing' : sources.length === 0 ? 'empty' : needsAttention ? 'needs_attention' : 'up_to_date'
  const doneCount = sources.filter((source) => source.status === 'indexed' || source.status === 'failed').length
  return replaceKnowledgeBase({
    ...knowledgeBase,
    status,
    syncProgress: isSyncing ? { done: doneCount, total: sources.length } : null,
    sourceCount: sources.length,
    fileCount: sources.filter((source) => source.kind !== 'url').reduce((total, source) => total + source.documentCount, 0),
    websiteCount: sources.filter((source) => source.kind === 'url').length,
    passageCount: sources.reduce((total, source) => total + source.passageCount, 0),
    updatedAt: new Date().toISOString(),
  })
}

function replaceSource(changed: KnowledgeSource): KnowledgeSource {
  storedSources = storedSources.map((source) => (source.id === changed.id ? changed : source))
  return { ...changed }
}

function displayNameOf(kind: KnowledgeSourceKind, location: string): string {
  if (kind === 'url') return location.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return location.split(/[\\/]/).filter(Boolean).pop() ?? location
}

/** Pretends to read the source: `reading` now, `indexed` with a few passages later. */
function pretendToIndex(source: KnowledgeSource): void {
  const reading = replaceSource({ ...source, status: 'reading' })
  emit({ type: 'sync_started', knowledgeBaseId: source.knowledgeBaseId })
  emit({ type: 'source_updated', knowledgeBaseId: source.knowledgeBaseId, source: reading, progressPercent: 0 })
  const timer = setTimeout(() => {
    pendingTimers.delete(timer)
    if (!storedSources.some((candidate) => candidate.id === source.id)) return
    const indexed = replaceSource({ ...reading, status: 'indexed', passageCount: 24, lastSyncedAt: new Date().toISOString() })
    emit({ type: 'source_updated', knowledgeBaseId: source.knowledgeBaseId, source: indexed, progressPercent: null })
    const knowledgeBase = replaceKnowledgeBase({ ...refreshTotals(source.knowledgeBaseId, false), lastSyncedAt: new Date().toISOString() })
    emit({ type: 'sync_finished', knowledgeBaseId: source.knowledgeBaseId, knowledgeBase })
  }, SAMPLE_INDEXING_DELAY_MS)
  pendingTimers.add(timer)
}

function chunkingKey(chunking: ChunkingSettings): string {
  return JSON.stringify(chunking)
}

function needsReindex(knowledgeBase: KnowledgeBase): boolean {
  const indexed = indexedChunking.get(knowledgeBase.id) ?? chunkingKey(defaultChunking())
  const hasPassages = storedSources.some((source) => source.knowledgeBaseId === knowledgeBase.id && source.passageCount > 0)
  return hasPassages && indexed !== chunkingKey(knowledgeBase.settings.chunking)
}

function step(settings: ChunkingSettings): number {
  return Math.max(settings.maxTokens - settings.overlapTokens, 1)
}

/** "Pretends to index again": every source turns `reading`, then gets passages for the new chunking. */
function pretendToReindex(knowledgeBaseId: string): void {
  const knowledgeBase = findKnowledgeBase(knowledgeBaseId)
  const previousKey = indexedChunking.get(knowledgeBaseId) ?? chunkingKey(defaultChunking())
  const previous = JSON.parse(previousKey) as ChunkingSettings
  const sources = storedSources
    .filter((source) => source.knowledgeBaseId === knowledgeBaseId)
    .map((source) => replaceSource({ ...source, status: 'reading' }))
  refreshTotals(knowledgeBaseId, true)
  emit({ type: 'sync_started', knowledgeBaseId })
  sources.forEach((source, index) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer)
      if (!storedSources.some((candidate) => candidate.id === source.id)) return
      // Same text, other passage size: the count scales with the step between passage starts.
      const passageCount = Math.max(1, Math.round((source.passageCount * step(previous)) / step(knowledgeBase.settings.chunking)))
      const indexed = replaceSource({ ...source, status: 'indexed', passageCount, lastSyncedAt: new Date().toISOString() })
      emit({ type: 'source_updated', knowledgeBaseId, source: indexed, progressPercent: null })
      if (index === sources.length - 1) {
        indexedChunking.set(knowledgeBaseId, chunkingKey(findKnowledgeBase(knowledgeBaseId).settings.chunking))
        const finished = replaceKnowledgeBase({ ...refreshTotals(knowledgeBaseId, false), lastSyncedAt: new Date().toISOString() })
        emit({ type: 'sync_finished', knowledgeBaseId, knowledgeBase: finished })
      }
    }, SAMPLE_INDEXING_DELAY_MS * (index + 1))
    pendingTimers.add(timer)
  })
}

/** Sample documents of a source: the file itself, the pages of a site or a few files of a folder. */
function documentsOf(source: KnowledgeSource): KnowledgeDocument[] {
  const knowledgeBase = findKnowledgeBase(source.knowledgeBaseId)
  const base = { sourceId: source.id, indexedAt: source.lastSyncedAt, needsReindex: needsReindex(knowledgeBase) }
  if (source.passageCount === 0) return []
  if (source.kind === 'file') return [{ ...base, documentId: source.id, name: source.name, passageCount: source.passageCount }]
  const names =
    source.kind === 'url'
      ? ['', 'menu', 'delivery', 'contact', 'about', 'faq'].slice(0, Math.max(source.documentCount, 1)).map((path) => `${source.name}/${path}`)
      : ['Kontrak sewa.pdf', 'SOP pengiriman.docx', 'Daftar harga 2026.xlsx', 'Notulen rapat.md']
  const each = Math.max(1, Math.floor(source.passageCount / names.length))
  return names.map((name, index) => ({
    ...base,
    documentId: `${source.id}/${index}`,
    name,
    passageCount: index === names.length - 1 ? Math.max(1, source.passageCount - each * (names.length - 1)) : each,
  }))
}

const sampleSentences = [
  'Paket Hemat berisi nasi, ayam goreng, sayur, sambal dan kerupuk.',
  'Paket Komplit menambah buah potong, puding dan air mineral.',
  'Free delivery inside Bandar Lampung for orders of 30 boxes or more.',
  'Orders under 30 boxes pay delivery based on distance.',
  'Pesanan dikonfirmasi setelah uang muka 50 persen ditransfer.',
  'Order at least two days ahead; same-day orders are accepted below 20 boxes.',
  'Menu vegetarian tersedia untuk semua paket tanpa biaya tambahan.',
  'Kitchen hours are 06:00 to 18:00, Monday to Saturday.',
]
const sampleHeadings = ['Menu > Paket', 'Menu > Harga', 'Delivery', 'Payment', 'FAQ']

/** Deterministic passages for a sample document cut with `chunking`. */
function sampleChunks(document: KnowledgeDocument, chunking: ChunkingSettings): KnowledgeChunk[] {
  const targetChars = Math.min(chunking.maxTokens * 4, 1400) * 0.8
  let position = 0
  return Array.from({ length: document.passageCount }, (_, index) => {
    const sentences: string[] = []
    let sentenceIndex = index
    while (sentences.join(' ').length < targetChars) {
      sentences.push(sampleSentences[sentenceIndex % sampleSentences.length] ?? '')
      sentenceIndex += 3
    }
    const text = sentences.join(' ')
    const charStart = position
    position += text.length + 2
    return {
      id: `${document.documentId}:${index}`,
      index,
      position: index + 1,
      text,
      charCount: text.length,
      tokenCount: Math.ceil(text.length / 4),
      charStart,
      charEnd: charStart + text.length,
      heading: chunking.respectHeadings ? (sampleHeadings[Math.floor(index / 4) % sampleHeadings.length] ?? null) : null,
      pages: document.name.toLowerCase().endsWith('.pdf') ? [Math.floor(index / 3) + 1] : [],
    }
  })
}

/** "Delivery and FAQ · page 11 · Catering menu and prices" -> source, location and base. */
function toPassage(samplePassage: SamplePassage): KnowledgePassage {
  const citationParts = samplePassage.citation.split(' · ')
  const knowledgeBaseName = citationParts.pop() ?? ''
  const [sourceName = '', location = null] = citationParts
  return {
    id: samplePassage.id,
    knowledgeBaseId: sampleKnowledgeBaseId,
    knowledgeBaseName,
    sourceId: null,
    sourceName,
    location,
    chunkIndex: null,
    page: null,
    text: samplePassage.text,
    score: samplePassage.score,
  }
}

export const sampleKnowledgeBackend = {
  listKnowledgeBases: (): Promise<KnowledgeBase[]> =>
    respondWith(() => storedKnowledgeBases.map((knowledgeBase) => ({ ...knowledgeBase, needsReindex: needsReindex(knowledgeBase) }))),

  getKnowledgeBase: (knowledgeBaseId: string): Promise<KnowledgeBaseDetail> =>
    respondWith(() => ({
      knowledgeBase: { ...findKnowledgeBase(knowledgeBaseId), needsReindex: needsReindex(findKnowledgeBase(knowledgeBaseId)) },
      sources: storedSources.filter((source) => source.knowledgeBaseId === knowledgeBaseId).map((source) => ({ ...source })),
    })),

  createKnowledgeBase: (name: string, description: string): Promise<KnowledgeBase> =>
    respondWith(() => {
      const trimmedName = requireText(name, 'give the knowledge base a name')
      createdCount += 1
      const now = new Date().toISOString()
      const knowledgeBase = seedKnowledgeBase({
        id: `kb_sample_${createdCount}`,
        name: trimmedName,
        description,
        status: 'empty',
        sourceCount: 0,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      storedKnowledgeBases = [knowledgeBase, ...storedKnowledgeBases]
      return { ...knowledgeBase }
    }),

  renameKnowledgeBase: (knowledgeBaseId: string, name: string): Promise<KnowledgeBase> =>
    respondWith(() => replaceKnowledgeBase({ ...findKnowledgeBase(knowledgeBaseId), name: requireText(name, 'give the knowledge base a name') })),

  deleteKnowledgeBase: (knowledgeBaseId: string): Promise<void> =>
    respondWith(() => {
      findKnowledgeBase(knowledgeBaseId)
      storedKnowledgeBases = storedKnowledgeBases.filter((knowledgeBase) => knowledgeBase.id !== knowledgeBaseId)
      storedSources = storedSources.filter((source) => source.knowledgeBaseId !== knowledgeBaseId)
    }),

  addKnowledgeSource: (knowledgeBaseId: string, kind: KnowledgeSourceKind, location: string): Promise<KnowledgeSource> =>
    respondWith(() => {
      findKnowledgeBase(knowledgeBaseId)
      const trimmedLocation = requireText(location, 'choose a file, folder or link')
      if (kind === 'url' && !/^https?:\/\/\S+$/i.test(trimmedLocation)) {
        throw new BackendError('invalid_input', 'invalid input: links must start with https:// or http://')
      }
      const fullLocation = kind === 'url' || trimmedLocation.startsWith('/') ? trimmedLocation : `${sampleFolder}/${trimmedLocation}`
      const name = displayNameOf(kind, fullLocation)
      if (storedSources.some((source) => source.knowledgeBaseId === knowledgeBaseId && source.location === fullLocation)) {
        throw new BackendError('invalid_input', `invalid input: ${name} is already in this knowledge base`)
      }
      createdCount += 1
      const source = seedSource({
        id: `src_sample_${createdCount}`,
        knowledgeBaseId,
        kind,
        name,
        location: fullLocation,
        status: 'pending',
        documentCount: kind === 'folder' ? 12 : 1,
        lastSyncedAt: null,
        createdAt: new Date().toISOString(),
      })
      storedSources = [...storedSources, source]
      refreshTotals(knowledgeBaseId, true)
      pretendToIndex(source)
      return { ...source }
    }),

  removeKnowledgeSource: (sourceId: string): Promise<void> =>
    respondWith(() => {
      const source = storedSources.find((candidate) => candidate.id === sourceId)
      if (!source) throw new BackendError('not_found', `knowledge source ${sourceId} not found`)
      storedSources = storedSources.filter((candidate) => candidate.id !== sourceId)
      refreshTotals(source.knowledgeBaseId, false)
    }),

  syncKnowledgeBase: (knowledgeBaseId: string): Promise<KnowledgeBase> =>
    respondWith(() => {
      const current = findKnowledgeBase(knowledgeBaseId)
      if (needsReindex(current)) {
        pretendToReindex(knowledgeBaseId)
        return { ...refreshTotals(knowledgeBaseId, true), needsReindex: true }
      }
      const knowledgeBase = replaceKnowledgeBase({ ...refreshTotals(knowledgeBaseId, false), lastSyncedAt: new Date().toISOString() })
      emit({ type: 'sync_finished', knowledgeBaseId, knowledgeBase })
      return knowledgeBase
    }),

  updateKnowledgeSettings: (knowledgeBaseId: string, settings: KnowledgeSettings): Promise<KnowledgeBase> =>
    respondWith(() => {
      if (settings.passagesPerAnswer < 1 || settings.passagesPerAnswer > 20) {
        throw new BackendError('invalid_input', 'invalid input: passages per answer must be between 1 and 20')
      }
      if (!(settings.minScore >= 0 && settings.minScore <= 1)) {
        throw new BackendError('invalid_input', 'invalid input: the minimum score must be between 0 and 1')
      }
      const chunking = settings.chunking
      if (chunking.maxTokens < 50 || chunking.maxTokens > 2000) {
        throw new BackendError('invalid_input', 'invalid input: the passage size must be between 50 and 2000 tokens')
      }
      if (chunking.overlapTokens > Math.floor(chunking.maxTokens / 2)) {
        throw new BackendError('invalid_input', 'invalid input: the overlap can be at most half of the passage size')
      }
      const saved = replaceKnowledgeBase({ ...findKnowledgeBase(knowledgeBaseId), settings: { ...settings, chunking: { ...chunking, separators: [...chunking.separators] } } })
      return { ...saved, needsReindex: needsReindex(saved) }
    }),

  listKnowledgeDocuments: (sourceId: string): Promise<KnowledgeDocument[]> =>
    respondWith(() => {
      const source = storedSources.find((candidate) => candidate.id === sourceId)
      if (!source) throw new BackendError('not_found', `knowledge source ${sourceId} not found`)
      return documentsOf(source)
    }),

  listKnowledgeChunks: (sourceId: string, documentId: string, filter: string, offset: number, limit: number): Promise<KnowledgeChunkPage> =>
    respondWith(() => {
      const source = storedSources.find((candidate) => candidate.id === sourceId)
      const document = source ? documentsOf(source).find((candidate) => candidate.documentId === documentId) : undefined
      if (!source || !document) throw new BackendError('not_found', `document ${documentId} not found`)
      const indexedWith = indexedChunking.get(source.knowledgeBaseId)
      const chunking = indexedWith ? (JSON.parse(indexedWith) as ChunkingSettings) : defaultChunking()
      const chunks = sampleChunks(document, chunking)
      const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
      const matching = chunks.filter((chunk) => words.every((word) => `${chunk.heading ?? ''} ${chunk.text}`.toLowerCase().includes(word)))
      const pageSize = Math.min(Math.max(limit, 1), 100)
      return {
        document,
        total: chunks.length,
        matching: matching.length,
        offset: Math.min(offset, matching.length),
        chunks: matching.slice(offset, offset + pageSize),
        totalChars: chunks.reduce((total, chunk) => total + chunk.charCount, 0),
        totalTokens: chunks.reduce((total, chunk) => total + chunk.tokenCount, 0),
      }
    }),

  searchKnowledge: (query: string, knowledgeBaseIds: string[] | undefined, limit: number): Promise<KnowledgePassage[]> =>
    respondWith(() => {
      knowledgeBaseIds?.forEach(findKnowledgeBase)
      const includesSampleBase = !knowledgeBaseIds || knowledgeBaseIds.includes(sampleKnowledgeBaseId)
      if (!includesSampleBase) return []
      return searchKnowledgePassages(query, knowledgePassages).slice(0, limit).map(toPassage)
    }),

  subscribeToKnowledgeEvents: (onKnowledgeEvent: (event: KnowledgeEvent) => void): Promise<() => void> => {
    // One wrapper per subscription: React's strict mode subscribes the same callback twice, and
    // ending the first subscription must not end the second.
    const listener = (event: KnowledgeEvent) => onKnowledgeEvent(event)
    listeners.add(listener)
    return Promise.resolve(() => {
      listeners.delete(listener)
    })
  },
}

/** Lets the connector sample backend (`knowledgeConnectors.ts`) add and update sources. */
export const sampleKnowledgeInternals = {
  findKnowledgeBase,
  findSource(sourceId: string): KnowledgeSource {
    const source = storedSources.find((candidate) => candidate.id === sourceId)
    if (!source) throw new BackendError('not_found', `knowledge source ${sourceId} not found`)
    return source
  },
  insertSource(source: KnowledgeSource): void {
    storedSources = [...storedSources, source]
    refreshTotals(source.knowledgeBaseId, true)
  },
  replaceSource,
  pretendToIndex,
  nextId(): number {
    createdCount += 1
    return createdCount
  },
}
