import type { KnowledgeEvent } from '../../knowledgeTypes'
import { resetSampleKnowledge, sampleKnowledgeBackend, SAMPLE_INDEXING_DELAY_MS } from '../knowledge'

describe('sample knowledge backend', () => {
  beforeEach(() => {
    resetSampleKnowledge()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds the knowledge screens', async () => {
    const knowledgeBases = await sampleKnowledgeBackend.listKnowledgeBases()
    expect(knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase.status])).toEqual([
      ['menu-and-prices', 'up_to_date'],
      ['company-documents', 'syncing'],
      ['team-wiki', 'needs_attention'],
      ['past-orders', 'up_to_date'],
    ])
    const detail = await sampleKnowledgeBackend.getKnowledgeBase('menu-and-prices')
    expect(detail.sources.map((source) => source.name)).toEqual(['Menu November.pdf', 'Price list.xlsx', 'Delivery and FAQ.md', '[YOUR WEBSITE]'])
  })

  it('creates a knowledge base, indexes a source with events and removes it', async () => {
    vi.useFakeTimers()
    const events: KnowledgeEvent[] = []
    const unsubscribe = await sampleKnowledgeBackend.subscribeToKnowledgeEvents((event) => events.push(event))
    const knowledgeBase = await sampleKnowledgeBackend.createKnowledgeBase('Policies', '')
    expect(knowledgeBase.status).toBe('empty')

    const source = await sampleKnowledgeBackend.addKnowledgeSource(knowledgeBase.id, 'folder', '/Users/you/Documents/Policies')
    expect(source).toMatchObject({ name: 'Policies', kind: 'folder', status: 'pending' })
    expect(events.map((event) => event.type)).toEqual(['sync_started', 'source_updated'])

    await vi.advanceTimersByTimeAsync(SAMPLE_INDEXING_DELAY_MS)
    expect(events.map((event) => event.type)).toEqual(['sync_started', 'source_updated', 'source_updated', 'sync_finished'])
    const finished = events[3]
    expect(finished.type === 'sync_finished' && finished.knowledgeBase).toMatchObject({ status: 'up_to_date', passageCount: 24, fileCount: 12 })

    await sampleKnowledgeBackend.removeKnowledgeSource(source.id)
    expect((await sampleKnowledgeBackend.getKnowledgeBase(knowledgeBase.id)).knowledgeBase.status).toBe('empty')
    unsubscribe()
  })

  it('rejects duplicates, bad links and unknown knowledge bases', async () => {
    await expect(sampleKnowledgeBackend.addKnowledgeSource('menu-and-prices', 'file', 'Menu November.pdf')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(sampleKnowledgeBackend.addKnowledgeSource('menu-and-prices', 'url', 'example.com')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(sampleKnowledgeBackend.getKnowledgeBase('missing')).rejects.toMatchObject({ code: 'not_found' })
    await expect(sampleKnowledgeBackend.createKnowledgeBase(' ', '')).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('searches the sample passages with their source and location', async () => {
    const passages = await sampleKnowledgeBackend.searchKnowledge('minimum order for free delivery', undefined, 4)
    expect(passages.map((passage) => passage.score)).toEqual([0.91, 0.74])
    expect(passages[1]).toMatchObject({ sourceName: 'Menu November.pdf', location: 'page 11', knowledgeBaseName: 'Catering menu and prices' })
    expect(await sampleKnowledgeBackend.searchKnowledge('free delivery', ['past-orders'], 4)).toEqual([])
    expect(await sampleKnowledgeBackend.searchKnowledge('free delivery', undefined, 1)).toHaveLength(1)
  })

  it('validates and saves settings, renames and deletes', async () => {
    const detail = await sampleKnowledgeBackend.getKnowledgeBase('past-orders')
    const settings = { ...detail.knowledgeBase.settings, passagesPerAnswer: 8 }
    expect((await sampleKnowledgeBackend.updateKnowledgeSettings('past-orders', settings)).settings.passagesPerAnswer).toBe(8)
    await expect(sampleKnowledgeBackend.updateKnowledgeSettings('past-orders', { ...settings, minScore: 2 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await sampleKnowledgeBackend.renameKnowledgeBase('past-orders', 'Orders 2026')).name).toBe('Orders 2026')
    await sampleKnowledgeBackend.deleteKnowledgeBase('past-orders')
    await expect(sampleKnowledgeBackend.getKnowledgeBase('past-orders')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps a second subscription of the same callback when the first one ends (strict mode)', async () => {
    const received: KnowledgeEvent[] = []
    const onEvent = (event: KnowledgeEvent) => received.push(event)
    const stopFirst = await sampleKnowledgeBackend.subscribeToKnowledgeEvents(onEvent)
    const stopSecond = await sampleKnowledgeBackend.subscribeToKnowledgeEvents(onEvent)
    stopFirst()
    await sampleKnowledgeBackend.syncKnowledgeBase('past-orders')
    expect(received.map((event) => event.type)).toEqual(['sync_finished'])
    stopSecond()
  })

  it('flags new chunking until the knowledge base is indexed again, and lists passages a page at a time', async () => {
    vi.useFakeTimers()
    const detail = await sampleKnowledgeBackend.getKnowledgeBase('menu-and-prices')
    const chunking = { ...detail.knowledgeBase.settings.chunking, maxTokens: 500 }
    const saved = await sampleKnowledgeBackend.updateKnowledgeSettings('menu-and-prices', { ...detail.knowledgeBase.settings, chunking })
    expect(saved.needsReindex).toBe(true)
    const [document] = await sampleKnowledgeBackend.listKnowledgeDocuments('menu-november')
    expect(document).toMatchObject({ name: 'Menu November.pdf', passageCount: 186, needsReindex: true })
    await sampleKnowledgeBackend.syncKnowledgeBase('menu-and-prices')
    await vi.advanceTimersByTimeAsync(SAMPLE_INDEXING_DELAY_MS * 5)
    expect((await sampleKnowledgeBackend.getKnowledgeBase('menu-and-prices')).knowledgeBase.needsReindex).toBe(false)
    const page = await sampleKnowledgeBackend.listKnowledgeChunks('menu-november', 'menu-november', '', 20, 20)
    expect(page.total).toBe(88)
    expect(page.chunks.map((chunk) => chunk.position)).toEqual(Array.from({ length: 20 }, (_, index) => index + 21))
  })
})
