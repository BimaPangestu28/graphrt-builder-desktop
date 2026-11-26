import { formatCurrency, formatNumber } from '@/i18n'
import type { NumberFormat } from './uiBlockTypes'

/** How a number is written in a chart, table or tile. */
export interface ValueFormat {
  format?: NumberFormat
  currency?: string
}

/** Fraction digits for an amount: none for large amounts and zero-decimal currencies, else up to 2. */
function currencyDigits(value: number): Intl.NumberFormatOptions {
  return Math.abs(value) >= 1000 ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : { maximumFractionDigits: 2 }
}

/**
 * A number in the block's format and the app's language.
 *
 * @param value - The number (number)
 * @param valueFormat - `format` and `currency` from the block (ValueFormat)
 * @param isAxis - Axis ticks: large numbers are always compact (boolean)
 * @returns "Rp125.000.000", "1,2 jt", "12,5%"... (string)
 *
 * @example
 * formatValue(12.5, { format: 'percent' }) // "12.5%" (English)
 */
export function formatValue(value: number, valueFormat: ValueFormat = {}, isAxis = false): string {
  const format = valueFormat.format ?? 'number'
  const compact = isAxis && Math.abs(value) >= 10000 ? { notation: 'compact' as const, maximumFractionDigits: 1 } : null
  switch (format) {
    case 'percent':
      return `${formatNumber(value, { maximumFractionDigits: 1 })}%`
    case 'currency':
      if (!valueFormat.currency) return formatNumber(value, compact ?? { maximumFractionDigits: 2 })
      return formatCurrency(value, valueFormat.currency, compact ?? currencyDigits(value))
    case 'compact':
      return formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 })
    default:
      return formatNumber(value, compact ?? { maximumFractionDigits: 2 })
  }
}

/** A table cell or tile value that may be text: numbers are formatted, text is shown as is. */
export function formatMaybeNumber(value: number | string | boolean | null | undefined, valueFormat: ValueFormat = {}): string {
  if (typeof value === 'number') return formatValue(value, valueFormat)
  if (value === null || value === undefined) return ''
  return String(value)
}
