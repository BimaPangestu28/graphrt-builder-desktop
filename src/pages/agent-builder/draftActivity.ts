import type { BuildStage } from '@/api/types'
import { messages } from '@/i18n'

/** Groups thousands for the token count ("1,204"), independent of the machine's locale. */
const tokenCountFormat = new Intl.NumberFormat('en-US')

/**
 * Formats a token count with thousands separators and the right noun.
 *
 * @param outputTokens - Tokens written so far (number)
 * @returns "1 token", "412 tokens" or "12,480 tokens" (string)
 *
 * @example
 * formatTokenCount(12480) // '12,480 tokens'
 */
export function formatTokenCount(outputTokens: number): string {
  const wholeTokens = Math.max(0, Math.round(outputTokens))
  return `${tokenCountFormat.format(wholeTokens)} ${wholeTokens === 1 ? 'token' : 'tokens'}`
}

/**
 * The quiet line next to the running stage while the model writes ("Writing… 412 tokens").
 *
 * @param stage - Stage the draft belongs to (BuildStage); `repairing` reads "Fixing…"
 * @param outputTokens - Tokens written so far in this round (number)
 * @returns The activity text (string)
 *
 * @example
 * describeDraftActivity('repairing', 1204) // 'Fixing… 1,204 tokens'
 */
export function describeDraftActivity(stage: BuildStage, outputTokens: number): string {
  const verb = stage === 'repairing' ? messages().builder.fixing : messages().builder.writing
  return `${verb} ${formatTokenCount(outputTokens)}`
}
