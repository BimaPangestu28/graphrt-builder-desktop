import { messages } from '@/i18n'
import { formatMaybeNumber, formatValue } from '../format'
import type { StatItem } from '../uiBlockTypes'

export type DeltaTone = 'good' | 'bad' | 'neutral'

export interface StatTile {
  label: string
  value: string
  caption: string | null
  /** Null when the item has no delta. */
  delta: { text: string; trend: 'up' | 'down' | 'flat'; tone: DeltaTone; spoken: string } | null
}

/**
 * What one KPI tile shows: the formatted value and, with a delta, "+12.5%" with its direction and whether
 * that is good news (`good`, default up). The direction is also spoken ("up 12.5%"), never colour alone.
 *
 * @param item - The `stats` item (StatItem)
 * @returns The tile (StatTile)
 */
export function buildStatTile(item: StatItem): StatTile {
  const value = formatMaybeNumber(item.value, { format: item.format, currency: item.currency })
  if (item.delta === undefined || item.delta === null) return { label: item.label, value, caption: item.caption ?? null, delta: null }
  const trend = item.trend ?? (item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'flat')
  const good = item.good ?? 'up'
  const tone: DeltaTone = trend === 'flat' ? 'neutral' : trend === good ? 'good' : 'bad'
  const magnitude = item.delta_format === 'percent' ? formatValue(Math.abs(item.delta), { format: 'percent' }) : formatValue(Math.abs(item.delta), { format: item.format === 'percent' ? 'percent' : 'number' })
  const sign = item.delta > 0 ? '+' : item.delta < 0 ? '−' : ''
  const word = { up: messages().visuals.deltaUp, down: messages().visuals.deltaDown, flat: messages().visuals.deltaFlat }[trend]
  return { label: item.label, value, caption: item.caption ?? null, delta: { text: `${sign}${magnitude}`, trend, tone, spoken: `${word} ${magnitude}` } }
}
