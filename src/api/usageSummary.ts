import { callBackend, isDesktopApp } from './client'
import { sampleUsageSummaryBackend } from './sampleBackend/usageSummary'
import type { UsageSummary } from './usageSummaryTypes'

/**
 * Runs started since `fromDate` and the AI tokens they used (Home "This month" card).
 *
 * @param fromDate - Start of the window, RFC 3339 with any offset (string)
 * @returns The totals (UsageSummary)
 * @throws BackendError - `invalid_input` when `fromDate` is not RFC 3339
 *
 * @example
 * const month = await getUsageSummary(new Date(2026, 10, 1).toISOString())
 */
export function getUsageSummary(fromDate: string): Promise<UsageSummary> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleUsageSummaryBackend.getUsageSummary(fromDate)
  return callBackend('get_usage_summary', { fromDate })
}
