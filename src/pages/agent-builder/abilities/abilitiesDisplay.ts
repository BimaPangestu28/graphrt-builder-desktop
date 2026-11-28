import { abilityBounds } from '@/api/abilitiesTypes'
import type { AgentAbilities, ContextSetting, HelperChoice, HelpersSetting, MemorySetting, SpendingLimit } from '@/api/abilitiesTypes'
import { formatNumber, numberLocaleTag } from '@/i18n/format'
import { messages } from '@/i18n'

/**
 * Plain-language summaries of an agent's abilities and the parsing of what the owner types
 * into the abilities editors (money in dollars, token counts).
 */

const microsPerDollar = 1_000_000

/**
 * Formats millionths of a dollar as dollars, with cents (more digits for tiny amounts).
 *
 * @example
 * formatUsd(500_000) // "$0.50"
 * formatUsd(1_500) // "$0.0015"
 */
export function formatUsd(micros: number): string {
  const dollars = micros / microsPerDollar
  const digits = dollars !== 0 && dollars < 0.01 ? 4 : 2
  return `$${formatNumber(dollars, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`
}

export function formatTokens(tokens: number): string {
  return formatNumber(tokens)
}

/** A parsed field: empty, a valid number, or something that is not allowed. */
export type ParsedAmount = { kind: 'empty' } | { kind: 'value'; value: number } | { kind: 'invalid' }

/** Reads a typed number, accepting `.` or `,` as decimal separator and spaces between thousands. */
function readNumber(text: string): number | null {
  const compact = text.trim().replace(/[\s$]/g, '')
  if (compact === '') return null
  // "1,000.50" or "1.000,50": the last separator is the decimal one when two kinds appear.
  const lastComma = compact.lastIndexOf(',')
  const lastDot = compact.lastIndexOf('.')
  let normalized = compact
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = compact.replace(',', '.')
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

/**
 * Reads a dollar amount typed by the owner into millionths of a dollar.
 *
 * @example
 * parseUsdToMicros('0.50') // { kind: 'value', value: 500000 }
 * parseUsdToMicros('0,5') // { kind: 'value', value: 500000 }
 * parseUsdToMicros('lots') // { kind: 'invalid' }
 */
export function parseUsdToMicros(text: string): ParsedAmount {
  const dollars = readNumber(text)
  if (dollars === null) return { kind: 'empty' }
  if (Number.isNaN(dollars)) return { kind: 'invalid' }
  const micros = Math.round(dollars * microsPerDollar)
  if (micros < abilityBounds.minCostMicros || micros > abilityBounds.maxCostMicros) return { kind: 'invalid' }
  return { kind: 'value', value: micros }
}

/** Reads a whole number of tokens between `min` and `max`, thousands separators allowed. */
export function parseTokenCount(text: string, min: number, max: number): ParsedAmount {
  const compact = text.trim().replace(/[\s.,]/g, '')
  if (compact === '') return { kind: 'empty' }
  if (!/^\d+$/.test(compact)) return { kind: 'invalid' }
  const tokens = Number(compact)
  return tokens < min || tokens > max ? { kind: 'invalid' } : { kind: 'value', value: tokens }
}

/** The limit from the spending editor's fields, or the message saying what is wrong. */
export function readSpendingDraft(isLimited: boolean, moneyText: string, tokensText: string): { limit: SpendingLimit } | { error: string } {
  const t = messages().abilities.spending
  if (!isLimited) return { limit: { maxTotalTokens: null, maxCostMicros: null } }
  const money = parseUsdToMicros(moneyText)
  const tokens = parseTokenCount(tokensText, abilityBounds.minTokens, abilityBounds.maxTokens)
  if (money.kind === 'invalid') return { error: t.invalidMoney }
  if (tokens.kind === 'invalid') return { error: t.invalidTokens }
  if (money.kind === 'empty' && tokens.kind === 'empty') return { error: t.needsOne }
  return { limit: { maxCostMicros: money.kind === 'value' ? money.value : null, maxTotalTokens: tokens.kind === 'value' ? tokens.value : null } }
}

/** Dollars as the money field shows them (no thousands separators, so it reads back). */
export function microsToFieldText(micros: number | null): string {
  if (micros === null) return ''
  return String(micros / microsPerDollar)
}

export function summarizeContext(context: ContextSetting): string {
  const t = messages().abilities.context
  const budget = context.maxTokens === null ? '' : t.budgetSummary(formatTokens(context.maxTokens))
  return `${t.summary[context.mode]}${budget}`
}

export function summarizeMemory(memory: MemorySetting): string {
  const t = messages().abilities.memory
  if (!memory.enabled) return t.summaryOff
  return memory.graph ? t.summaryGraph : t.summaryOn
}

/** "Can ask Stock checker and Invoices" with the helpers' names, in the order chosen. */
export function summarizeHelpers(helpers: HelpersSetting, choices: readonly HelperChoice[]): string {
  const t = messages().abilities.helpers
  if (helpers.agentIds.length === 0) return t.summaryNone
  const names = helpers.agentIds.map((agentId) => choices.find((choice) => choice.agentId === agentId)?.name ?? messages().abilities.helperTree.unknownAgent)
  return t.summarySome(new Intl.ListFormat(numberLocaleTag(), { style: 'long', type: 'conjunction' }).format(names))
}

export function summarizeSpending(limit: SpendingLimit): string {
  const t = messages().abilities.spending
  const { maxCostMicros, maxTotalTokens } = limit
  if (maxCostMicros !== null && maxTotalTokens !== null) return t.summaryBoth(formatUsd(maxCostMicros), formatTokens(maxTotalTokens))
  if (maxCostMicros !== null) return t.summaryMoney(formatUsd(maxCostMicros))
  if (maxTotalTokens !== null) return t.summaryTokens(formatTokens(maxTotalTokens))
  return t.summaryNone
}

/** Why an ability cannot be set on this agent, or `null` when it can. */
export function abilityUnavailableReason(abilities: AgentAbilities, needs: 'agentStep' | 'modelStep'): string | null {
  const t = messages().abilities.section
  if (needs === 'modelStep') return abilities.modelSteps === 0 ? t.needsModelStep : null
  return abilities.agentSteps === 0 ? t.needsAgentStep : null
}
