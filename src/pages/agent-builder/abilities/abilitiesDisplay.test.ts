import { setLocale } from '@/i18n'
import { formatUsd, microsToFieldText, parseTokenCount, parseUsdToMicros, readSpendingDraft, summarizeContext, summarizeHelpers, summarizeMemory, summarizeSpending } from './abilitiesDisplay'

describe('abilities display', () => {
  afterEach(() => setLocale('en'))

  it('formats money in dollars with more digits for tiny amounts', () => {
    expect(formatUsd(500_000)).toBe('$0.50')
    expect(formatUsd(1_500)).toBe('$0.0015')
    expect(formatUsd(12_000_000)).toBe('$12.00')
  })

  it('reads dollars with a dot or a comma and refuses what is outside the bounds', () => {
    expect(parseUsdToMicros('0.50')).toEqual({ kind: 'value', value: 500_000 })
    expect(parseUsdToMicros('0,5')).toEqual({ kind: 'value', value: 500_000 })
    expect(parseUsdToMicros(' $1,000.00 ')).toEqual({ kind: 'value', value: 1_000_000_000 })
    expect(parseUsdToMicros('1.000,00')).toEqual({ kind: 'value', value: 1_000_000_000 })
    expect(parseUsdToMicros('')).toEqual({ kind: 'empty' })
    expect(parseUsdToMicros('lots')).toEqual({ kind: 'invalid' })
    expect(parseUsdToMicros('0.0001')).toEqual({ kind: 'invalid' })
    expect(parseUsdToMicros('5000')).toEqual({ kind: 'invalid' })
    expect(parseUsdToMicros(microsToFieldText(250_000))).toEqual({ kind: 'value', value: 250_000 })
  })

  it('reads token counts with thousands separators', () => {
    expect(parseTokenCount('20,000', 1_000, 100_000)).toEqual({ kind: 'value', value: 20_000 })
    expect(parseTokenCount('20.000', 1_000, 100_000)).toEqual({ kind: 'value', value: 20_000 })
    expect(parseTokenCount('20k', 1_000, 100_000)).toEqual({ kind: 'invalid' })
    expect(parseTokenCount('10', 1_000, 100_000)).toEqual({ kind: 'invalid' })
  })

  it('turns the spending editor into a limit or says what is wrong', () => {
    expect(readSpendingDraft(false, 'x', 'y')).toEqual({ limit: { maxTotalTokens: null, maxCostMicros: null } })
    expect(readSpendingDraft(true, '0.25', '')).toEqual({ limit: { maxCostMicros: 250_000, maxTotalTokens: null } })
    expect(readSpendingDraft(true, '', '')).toEqual({ error: 'Enter a money or a token limit, or choose "No limit".' })
    expect(readSpendingDraft(true, 'abc', '')).toEqual({ error: 'Enter an amount between $0.001 and $1,000.' })
  })

  it('summarizes each ability in a short line', () => {
    expect(summarizeContext({ mode: 'auto', maxTokens: null })).toBe('Makes room automatically')
    expect(summarizeContext({ mode: 'summarize', maxTokens: 60_000 })).toBe('Summarizes older parts, up to 60,000 tokens')
    expect(summarizeMemory({ enabled: false, graph: true })).toBe('Starts fresh each time')
    expect(summarizeMemory({ enabled: true, graph: true })).toBe('Remembers each customer, with connections')
    const choices = [
      { agentId: 'a', name: 'Stock checker', description: '', unavailable: null },
      { agentId: 'b', name: 'Invoices', description: '', unavailable: null },
    ]
    expect(summarizeHelpers({ agentIds: [], maxParallel: 4, maxCalls: 16 }, choices)).toBe('Works alone')
    expect(summarizeHelpers({ agentIds: ['a', 'b'], maxParallel: 4, maxCalls: 16 }, choices)).toBe('Can ask Stock checker and Invoices')
    expect(summarizeHelpers({ agentIds: ['gone'], maxParallel: 4, maxCalls: 16 }, choices)).toBe('Can ask Another agent')
    expect(summarizeSpending({ maxCostMicros: 500_000, maxTotalTokens: 20_000 })).toBe('Up to $0.50 or 20,000 tokens')
    expect(summarizeSpending({ maxCostMicros: null, maxTotalTokens: null })).toBe('No limit')
  })

  it('speaks Indonesian with Indonesian number formats', () => {
    setLocale('id')
    expect(summarizeSpending({ maxCostMicros: null, maxTotalTokens: 20_000 })).toBe('Maksimal 20.000 token per run')
    expect(summarizeHelpers({ agentIds: ['a', 'b'], maxParallel: 4, maxCalls: 16 }, [
      { agentId: 'a', name: 'Cek stok', description: '', unavailable: null },
      { agentId: 'b', name: 'Tagihan', description: '', unavailable: null },
    ])).toBe('Bisa minta bantuan Cek stok dan Tagihan')
  })
})
