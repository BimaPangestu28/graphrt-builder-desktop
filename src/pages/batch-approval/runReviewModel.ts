import type { ApprovalAction, PendingApproval, RunReview } from '@/api/runReviewTypes'
import type { RunTrigger } from '@/api/types'
import { describeToolName } from '@/pages/agent-run/approvalDisplay'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/**
 * Display helpers for screen 19 (Review a run): row titles from the iteration item, the action
 * pair the bulk controls use, and the run's progress line. All text comes from the review.
 */

const itemNameKeys = ['name', 'title', 'label']
const maxItemMetaParts = 2
const maxItemMetaLength = 30

const triggerLabels: Readonly<Record<RunTrigger, string>> = localizedRecord(() => messages().agentRun.triggers)

function asItemRecord(item: unknown): Record<string, unknown> | null {
  return item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
}

/**
 * "[PLACE NAME 1]" from the item's name/title, else the item text, the tool a tool call uses,
 * "Item 4", the prompt or the step title.
 */
export function buildRowTitle(approval: PendingApproval): string {
  const item = approval.container?.item
  const itemRecord = asItemRecord(item)
  for (const key of itemNameKeys) {
    const nameValue = itemRecord?.[key]
    if (typeof nameValue === 'string' && nameValue.trim()) return nameValue
  }
  if (typeof item === 'string' && item.trim() && item.length <= maxItemMetaLength * 2) return item
  if (approval.toolCall) return describeToolName(approval.toolCall)
  if (approval.container) return messages().agentRun.itemNumber(approval.container.index + 1)
  return approval.prompt?.split('\n')[0] ?? approval.stepTitle ?? messages().agentRun.question
}

/** "Office · score 9": up to two short item fields besides its name. */
export function buildRowMeta(approval: PendingApproval): string | null {
  const itemRecord = asItemRecord(approval.container?.item)
  if (!itemRecord) return null
  const parts = Object.entries(itemRecord)
    .filter(([key]) => !itemNameKeys.includes(key))
    .flatMap(([key, fieldValue]) => {
      if (typeof fieldValue === 'string' && fieldValue.trim() && fieldValue.length <= maxItemMetaLength) return [fieldValue]
      if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) return [`${key.replace(/[_-]+/g, ' ').toLowerCase()} ${fieldValue}`]
      return []
    })
    .slice(0, maxItemMetaParts)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The yes/no pair every pending question shares (first action = tick, second = untick), or null
 * when the questions have different actions or not exactly two (then each row lists every action).
 */
export function findSharedActionPair(pending: PendingApproval[]): [ApprovalAction, ApprovalAction] | null {
  const [firstApproval] = pending
  if (!firstApproval || firstApproval.actions.length !== 2) return null
  const actionIds = firstApproval.actions.map((action) => action.id).join('\n')
  const isShared = pending.every((approval) => approval.actions.map((action) => action.id).join('\n') === actionIds)
  return isShared ? [firstApproval.actions[0], firstApproval.actions[1]] : null
}

/** "Maps leads to WhatsApp · scheduled run · Today 09:00" */
export function describeReviewedRun(review: RunReview): string {
  return `${review.agentName} · ${triggerLabels[review.trigger]} · ${formatRunDay(review.startedAt)}`
}

/** "3 of 15 For each place done": the innermost iteration's progress, when graphrt's snapshot said. */
export function describeIterationProgress(pending: PendingApproval[]): string | null {
  const container = pending.find((approval) => approval.container?.total !== null && approval.container?.total !== undefined)?.container
  if (!container || container.total === null) return null
  const finished = container.finished ?? 0
  const title = container.title ?? messages().agentRun.itemsWord
  return messages().agentRun.iterationProgress(finished, container.total, title)
}

/** True when the iteration has items after the questions shown now (or graphrt did not say). */
export function hasItemsAfterThese(pending: PendingApproval[]): boolean {
  const container = pending[0]?.container
  if (!container || container.nodeType === 'loop') return false
  if (container.total === null || container.finished === null) return true
  return container.finished + pending.length < container.total
}

/** "Send 2 · Skip 1" from the answers given so far; null when none. */
export function summarizeAnswers(review: RunReview, actionTitles: Map<string, string>): string | null {
  if (review.answered.length === 0) return null
  const countByAction = new Map<string, number>()
  // A question already answered is no longer pending: its own answer knows the button's title.
  const answeredTitles = new Map(review.answered.flatMap((answered) => (answered.actionTitle ? [[answered.action, answered.actionTitle] as const] : [])))
  for (const answered of review.answered) countByAction.set(answered.action, (countByAction.get(answered.action) ?? 0) + 1)
  return [...countByAction.entries()].map(([actionId, count]) => `${actionTitles.get(actionId) ?? answeredTitles.get(actionId) ?? actionId} ${count}`).join(' · ')
}
