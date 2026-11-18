import type { RunCounter } from '@/api/runSummaryTypes'

/**
 * Display helpers for run counters (numeric run outputs such as `messages_sent`).
 * Names may be snake_case (the convention) or camelCase (older sample data).
 */

const moneyUnitWord = 'usd'
const upperCaseWords = new Set(['ai', 'api', 'url', 'csv', 'pdf', 'sms'])
/** Counters that report something the agent did, preferred on Home cards. */
const actionCounterPattern = /(sent|added|created|replied|booked|posted|updated|saved|summari[sz]ed|ordered)/

function splitCounterName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[_\s-]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0)
}

/** True for money counters, named with a trailing `usd` (e.g. `ai_cost_usd`). */
export function isMoneyCounter(name: string): boolean {
  return splitCounterName(name).at(-1) === moneyUnitWord
}

/**
 * Plain label for a counter name.
 *
 * @example
 * formatCounterLabel('messages_sent') // "Messages sent"
 * formatCounterLabel('aiCostUsd')     // "AI cost"
 */
export function formatCounterLabel(name: string): string {
  const words = splitCounterName(name)
  const labelWords = isMoneyCounter(name) && words.length > 1 ? words.slice(0, -1) : words
  const sentence = labelWords.map((word) => (upperCaseWords.has(word) ? word.toUpperCase() : word)).join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * Display value: "$0.004" for money, "1,240" for whole numbers, at most two decimals otherwise.
 *
 * @example
 * formatCounterValue('ai_cost_usd', 0.004) // "$0.004"
 */
export function formatCounterValue(name: string, value: number): string {
  if (isMoneyCounter(name)) return `$${Number(value.toFixed(3))}`
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return String(Number(value.toFixed(2)))
}

/**
 * The counter that best describes what an agent did (e.g. `messages_sent`), for a Home card:
 * the first action-like counter, else the first counter that is not money.
 */
export function pickHeadlineCounter(counters: RunCounter[]): RunCounter | null {
  const nonMoneyCounters = counters.filter((counter) => !isMoneyCounter(counter.name))
  return nonMoneyCounters.find((counter) => actionCounterPattern.test(counter.name.toLowerCase())) ?? nonMoneyCounters[0] ?? null
}
