import type { PendingApproval, PendingToolCall } from '@/api/runReviewTypes'

/**
 * Display text for approval cards and rows: an approval's deadline ("Expires in 2h"), what
 * happens then, and the tool a tool call question is about with its arguments as pretty JSON.
 */

const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
/** Below this many hours the minutes are shown too ("Expires in 1h 30m"). */
const hoursShownWithMinutes = 10

function describeDuration(durationMs: number): string {
  if (durationMs >= dayMs) return `${Math.floor(durationMs / dayMs)}d`
  if (durationMs >= hourMs) {
    const hours = Math.floor(durationMs / hourMs)
    const minutes = Math.floor((durationMs % hourMs) / minuteMs)
    return minutes > 0 && hours < hoursShownWithMinutes ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (durationMs >= minuteMs) return `${Math.floor(durationMs / minuteMs)} min`
  return 'less than a minute'
}

/**
 * Time left before an approval expires.
 *
 * @param expiresAt - The deadline (ISO 8601) or null (string | null)
 * @param now - Current time in ms (number)
 * @returns "Expires in 2h", "Expiring now" once past, or null without a deadline (string | null)
 *
 * @example
 * describeTimeLeft('2026-11-21T12:00:00Z', Date.parse('2026-11-21T10:00:00Z')) // "Expires in 2h"
 */
export function describeTimeLeft(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null
  const deadline = Date.parse(expiresAt)
  if (Number.isNaN(deadline)) return null
  const timeLeftMs = deadline - now
  return timeLeftMs <= 0 ? 'Expiring now' : `Expires in ${describeDuration(timeLeftMs)}`
}

/** "then Skip" / "then the run stops"; null when the question never expires. */
export function describeTimeoutOutcome(approval: PendingApproval): string | null {
  if (!approval.expiresAt) return null
  const onTimeout = approval.onTimeout ?? { kind: 'stop' }
  if (onTimeout.kind === 'stop') return 'then the run stops'
  const title = approval.actions.find((action) => action.id === onTimeout.action)?.title ?? onTimeout.action
  return `then ${title}`
}

/** "Expires in 2h, then Skip": the deadline line of a card; null without a deadline. */
export function describeDeadline(approval: PendingApproval, now: number): string | null {
  const timeLeft = describeTimeLeft(approval.expiresAt, now)
  if (!timeLeft) return null
  const outcome = describeTimeoutOutcome(approval)
  return outcome ? `${timeLeft}, ${outcome}` : timeLeft
}

/** "whatsapp-web › send_message", or the name the model called when the provider is unknown. */
export function describeToolName(toolCall: PendingToolCall): string {
  return toolCall.provider ? `${toolCall.provider} › ${toolCall.tool ?? toolCall.name}` : toolCall.name
}

/** The arguments as indented JSON (text arguments as they are). */
export function formatToolArguments(toolArguments: unknown): string {
  if (typeof toolArguments === 'string') return toolArguments
  if (toolArguments === null || toolArguments === undefined) return '{}'
  return JSON.stringify(toolArguments, null, 2)
}

/** "phone: +62 · text: Halo…": the arguments on one line, for list rows. */
export function summarizeToolArguments(toolArguments: unknown): string {
  if (!toolArguments || typeof toolArguments !== 'object' || Array.isArray(toolArguments)) return formatToolArguments(toolArguments)
  return Object.entries(toolArguments as Record<string, unknown>)
    .map(([name, argumentValue]) => `${name}: ${typeof argumentValue === 'string' ? argumentValue : JSON.stringify(argumentValue)}`)
    .join(' · ')
}
