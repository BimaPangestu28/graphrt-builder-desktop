import type { PluginCatalog } from '@/api/pluginTypes'
import { CATALOG_STALE_AFTER_MS, isCatalogStale } from '@/hooks/usePluginCatalogRefresh'
import { describeCatalogFreshness } from './catalogFreshness'

const nowMs = Date.parse('2026-11-21T12:00:00Z')

function catalogFetched(fetchedAt: string | null, overrides: Partial<PluginCatalog> = {}): PluginCatalog {
  return { plugins: [], generatedAt: null, fromCache: fetchedAt === null, fetchedAt, ...overrides }
}

describe('describeCatalogFreshness', () => {
  it('says how long ago the app fetched the catalog', () => {
    expect(describeCatalogFreshness(catalogFetched('2026-11-21T11:59:30Z'), nowMs)).toBe('Updated just now')
    expect(describeCatalogFreshness(catalogFetched('2026-11-21T11:59:00Z'), nowMs)).toBe('Updated 1 minute ago')
    expect(describeCatalogFreshness(catalogFetched('2026-11-21T11:48:00Z'), nowMs)).toBe('Updated 12 minutes ago')
    expect(describeCatalogFreshness(catalogFetched('2026-11-21T09:00:00Z'), nowMs)).toBe('Updated 3 hours ago')
  })

  it('adds when the catalog was published, and copes with missing or odd dates', () => {
    expect(describeCatalogFreshness(catalogFetched('2026-11-21T12:00:00Z', { generatedAt: '2026-11-01T00:00:00Z' }), nowMs)).toMatch(/^Updated just now · catalog published /)
    expect(describeCatalogFreshness(catalogFetched(null, { generatedAt: '2026-11-01T00:00:00Z' }), nowMs)).toMatch(/^Catalog published /)
    expect(describeCatalogFreshness(catalogFetched('not a date', { generatedAt: 'nope' }), nowMs)).toBe('')
  })
})

describe('isCatalogStale', () => {
  it('is stale only for a fetched catalog older than 10 minutes', () => {
    expect(isCatalogStale(catalogFetched(new Date(nowMs - CATALOG_STALE_AFTER_MS - 1000).toISOString()), nowMs)).toBe(true)
    expect(isCatalogStale(catalogFetched(new Date(nowMs - 60_000).toISOString()), nowMs)).toBe(false)
    expect(isCatalogStale(catalogFetched(null), nowMs)).toBe(false)
    expect(isCatalogStale(null, nowMs)).toBe(false)
  })
})
