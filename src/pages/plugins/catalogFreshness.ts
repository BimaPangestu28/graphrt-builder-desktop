import type { PluginCatalog } from '@/api/pluginTypes'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

function describeAge(ageMs: number): string {
  if (ageMs < MINUTE_MS) return 'just now'
  if (ageMs < HOUR_MS) {
    const minutes = Math.floor(ageMs / MINUTE_MS)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.floor(ageMs / HOUR_MS)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

function formatPublishedDate(generatedAt: string): string | null {
  const publishedAtMs = Date.parse(generatedAt)
  if (!Number.isFinite(publishedAtMs)) return null
  return new Date(publishedAtMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * How fresh the shown catalog is: "Updated just now" / "Updated 12 minutes ago" from when
 * the app fetched it, then when the catalog was published.
 *
 * @param catalog - The catalog shown (PluginCatalog)
 * @param nowMs - Current time in ms since the epoch (number)
 * @returns e.g. "Updated just now · catalog published Nov 1, 2026", or "" when nothing is known (string)
 *
 * @example
 * describeCatalogFreshness(catalog, Date.now()) // "Updated 3 minutes ago · catalog published Nov 1, 2026"
 */
export function describeCatalogFreshness(catalog: PluginCatalog, nowMs: number): string {
  const parts: string[] = []
  const fetchedAtMs = catalog.fetchedAt ? Date.parse(catalog.fetchedAt) : Number.NaN
  if (Number.isFinite(fetchedAtMs)) parts.push(`Updated ${describeAge(Math.max(0, nowMs - fetchedAtMs))}`)
  const publishedDate = catalog.generatedAt ? formatPublishedDate(catalog.generatedAt) : null
  if (publishedDate) parts.push(parts.length > 0 ? `catalog published ${publishedDate}` : `Catalog published ${publishedDate}`)
  return parts.join(' · ')
}
