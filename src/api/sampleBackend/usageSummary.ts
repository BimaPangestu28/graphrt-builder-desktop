import { BackendError } from '../client'
import type { UsageSummary } from '../usageSummaryTypes'
import { respondWith } from './sampleResponse'

/**
 * Sample "This month" totals for the browser preview and tests. The run count matches the
 * Home design (64); the token figures are invented sample content.
 */

const sampleMonthRunCount = 64
const sampleMonthRunsWithUsage = 58
const samplePromptTokens = 301_400
const sampleCompletionTokens = 110_800

/** @throws BackendError - `invalid_input` when `fromDate` is not a readable time */
function summarizeSampleMonth(fromDate: string): UsageSummary {
  const fromInstant = new Date(fromDate)
  if (Number.isNaN(fromInstant.getTime())) throw new BackendError('invalid_input', `"${fromDate}" is not an RFC 3339 time`)
  return {
    from: fromInstant.toISOString(),
    runCount: sampleMonthRunCount,
    runsWithUsage: sampleMonthRunsWithUsage,
    usage: {
      promptTokens: samplePromptTokens,
      completionTokens: sampleCompletionTokens,
      totalTokens: samplePromptTokens + sampleCompletionTokens,
    },
  }
}

export const sampleUsageSummaryBackend = {
  getUsageSummary: (fromDate: string): Promise<UsageSummary> => respondWith(() => summarizeSampleMonth(fromDate)),
}
