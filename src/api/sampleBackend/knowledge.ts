import { BackendError } from '../client'
import type {
  KnowledgeBase,
  KnowledgeBaseDetail,
  KnowledgeEvent,
  KnowledgePassage,
  KnowledgeSettings,
  KnowledgeSource,
  KnowledgeSourceKind,
} from '../knowledgeTypes'
import { knowledgePassages, searchKnowledgePassages, type KnowledgePassage as SamplePassage } from '@/api/sampleBackend/fixtures/knowledgePassages'
import { requireText, respondWith } from './sampleResponse'

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
const sampleFolder = '/Users/you/Documents'
const seedCreatedAt = '2026-10-01T02:00:00Z'
/** 13:02 on the sample day in the viewer's time zone, as on the mockup. */
const seedLastSyncedAt = new Date(2026, 10, 18, 13, 2).toISOString()

const defaultSettings: KnowledgeSettings = { embedding: 'local', passagesPerAnswer: 4, minScore: 0.55, showSources: true }

function seedKnowledgeBase(fields: Partial<KnowledgeBase> & Pick<KnowledgeBase, 'id' | 'name'>): KnowledgeBase {
  return {
    description: '',
    settings: { ...defaultSettings },
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
    seedSource({ id: 'kantor-folder', knowledgeBaseId: 'company-documents', kind: 'folder', name: 'Kantor', location: `${sampleFolder}/Kantor`, documentCount: 138, status: 'reading', passageCount: 2310 }),
    seedSource({ id: 'orders-csv', knowledgeBaseId: 'past-orders', name: 'Orders.csv', passageCount: 96 }),
  ]
}

let storedKnowledgeBases: KnowledgeBase[] = []
let storedSources: KnowledgeSource[] = []
let createdCount = 0
const listeners = new Set<(event: KnowledgeEvent) => void>()
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

/** Puts the sample knowledge back to the seed and cancels pretend indexing. */
export function resetSampleKnowledge(): void {
  storedKnowledgeBases = buildSeedKnowledgeBases()
  storedSources = buildSeedSources()
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
    text: samplePassage.text,
    score: samplePassage.score,
  }
}

export const sampleKnowledgeBackend = {
  listKnowledgeBases: (): Promise<KnowledgeBase[]> => respondWith(() => storedKnowledgeBases.map((knowledgeBase) => ({ ...knowledgeBase }))),

  getKnowledgeBase: (knowledgeBaseId: string): Promise<KnowledgeBaseDetail> =>
    respondWith(() => ({
      knowledgeBase: { ...findKnowledgeBase(knowledgeBaseId) },
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
      findKnowledgeBase(knowledgeBaseId)
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
      return replaceKnowledgeBase({ ...findKnowledgeBase(knowledgeBaseId), settings: { ...settings } })
    }),

  searchKnowledge: (query: string, knowledgeBaseIds: string[] | undefined, limit: number): Promise<KnowledgePassage[]> =>
    respondWith(() => {
      knowledgeBaseIds?.forEach(findKnowledgeBase)
      const includesSampleBase = !knowledgeBaseIds || knowledgeBaseIds.includes(sampleKnowledgeBaseId)
      if (!includesSampleBase) return []
      return searchKnowledgePassages(query, knowledgePassages).slice(0, limit).map(toPassage)
    }),

  subscribeToKnowledgeEvents: (onKnowledgeEvent: (event: KnowledgeEvent) => void): Promise<() => void> => {
    listeners.add(onKnowledgeEvent)
    return Promise.resolve(() => {
      listeners.delete(onKnowledgeEvent)
    })
  },
}
