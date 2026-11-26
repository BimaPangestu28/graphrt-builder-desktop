import type { PluginCatalog } from '@/api/pluginTypes'
import { intlTag, messages } from '@/i18n'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

function describeAge(ageMs: number): string {
  const t = messages().plugins
  if (ageMs < MINUTE_MS) return t.justNow
  if (ageMs < HOUR_MS) return t.minutesAgo(Math.floor(ageMs / MINUTE_MS))
  return t.hoursAgo(Math.floor(ageMs / HOUR_MS))
}

function formatPublishedDate(generatedAt: string): string | null {
  const publishedAtMs = Date.parse(generatedAt)
  if (!Number.isFinite(publishedAtMs)) return null
  return new Date(publishedAtMs).toLocaleDateString(intlTag(), { year: 'numeric', month: 'short', day: 'numeric' })
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
  const t = messages().plugins
  if (Number.isFinite(fetchedAtMs)) parts.push(t.updatedAgo(describeAge(Math.max(0, nowMs - fetchedAtMs))))
  const publishedDate = catalog.generatedAt ? formatPublishedDate(catalog.generatedAt) : null
  if (publishedDate) parts.push(t.catalogPublished(publishedDate, parts.length === 0))
  return parts.join(' · ')
}
