import { allowActionId } from '@/api/pauseReasons'
import type { ApprovalAnswer, ApprovalField, PendingApproval } from '@/api/runReviewTypes'

/**
 * Form state of a graphrt `human-input` question: values the user edits, which control each
 * field gets, what is still missing, and the `{ action, values }` answer the run resumes with.
 * Values are kept as strings for text and number fields and as booleans for checkboxes.
 */

export type ApprovalFieldControl = 'text' | 'textarea' | 'number' | 'checkbox'

export type ApprovalValues = Record<string, string | boolean>

/** Defaults this long (or with a line break) are edited in a textarea even when typed `text`. */
const longTextLength = 60

const textareaTypes = new Set(['paragraph', 'textarea', 'long-text', 'longtext', 'multiline'])
const numberTypes = new Set(['number', 'integer', 'float'])
const checkboxTypes = new Set(['checkbox', 'boolean', 'bool'])

/** The control a field is edited with, from its graphrt `type`. */
export function controlForField(field: ApprovalField): ApprovalFieldControl {
  const fieldType = field.fieldType.trim().toLowerCase()
  if (numberTypes.has(fieldType)) return 'number'
  if (checkboxTypes.has(fieldType)) return 'checkbox'
  if (textareaTypes.has(fieldType)) return 'textarea'
  const defaultText = typeof field.defaultValue === 'string' ? field.defaultValue : ''
  return defaultText.length > longTextLength || defaultText.includes('\n') ? 'textarea' : 'text'
}

function initialFieldValue(field: ApprovalField): string | boolean {
  const control = controlForField(field)
  if (control === 'checkbox') return field.defaultValue === true
  if (field.defaultValue === null || field.defaultValue === undefined) return ''
  return typeof field.defaultValue === 'string' ? field.defaultValue : JSON.stringify(field.defaultValue)
}

/**
 * The values a question starts with: each field's rendered default.
 *
 * @param approval - The pending question (PendingApproval)
 * @returns Values keyed by field name (ApprovalValues)
 */
export function initialApprovalValues(approval: PendingApproval): ApprovalValues {
  return Object.fromEntries(approval.fields.map((field) => [field.name, initialFieldValue(field)]))
}

/** Labels of required fields that are still empty (graphrt rejects every action until they are filled). */
export function findMissingRequiredFields(approval: PendingApproval, values: ApprovalValues): string[] {
  return approval.fields
    .filter((field) => field.required && controlForField(field) !== 'checkbox')
    .filter((field) => String(values[field.name] ?? '').trim().length === 0)
    .map((field) => field.label)
}

function toAnswerValue(field: ApprovalField, value: string | boolean | undefined): unknown {
  const control = controlForField(field)
  if (control === 'checkbox') return value === true
  const text = typeof value === 'string' ? value : ''
  if (control === 'number') return text.trim() === '' ? null : Number(text)
  return text
}

/**
 * The answer the paused node expects: `{ action, values }` for a `human-input` form, and
 * `{ approvals: { [callId]: allowed } }` for a tool call (Allow → true, Decline → false).
 *
 * @example
 * buildApprovalAnswer(approval, 'approve', { message: 'Hi' }) // { action: 'approve', values: { message: 'Hi' } }
 * buildApprovalAnswer(toolCallApproval, 'allow', {}) // { approvals: { call_1: true } }
 */
export function buildApprovalAnswer(approval: PendingApproval, actionId: string, values: ApprovalValues): ApprovalAnswer {
  if (approval.kind === 'toolCall' && approval.toolCall) return { approvals: { [approval.toolCall.callId]: actionId === allowActionId } }
  return { action: actionId, values: Object.fromEntries(approval.fields.map((field) => [field.name, toAnswerValue(field, values[field.name])])) }
}

/**
 * Answers keyed by resume key for `resumeRun`. Tool call answers of the same agent step share a
 * resume key, so their `approvals` are merged into one answer.
 *
 * @param answers - Each question with its answer (Array<[PendingApproval, ApprovalAnswer]>)
 * @returns `{ [resumeKey]: answer }` (Record<string, ApprovalAnswer>)
 */
export function collectAnswersByResumeKey(answers: Array<[PendingApproval, ApprovalAnswer]>): Record<string, ApprovalAnswer> {
  const answersByResumeKey: Record<string, ApprovalAnswer> = {}
  for (const [approval, answer] of answers) {
    const earlierAnswer = answersByResumeKey[approval.resumeKey]
    answersByResumeKey[approval.resumeKey] =
      earlierAnswer && 'approvals' in earlierAnswer && 'approvals' in answer ? { approvals: { ...earlierAnswer.approvals, ...answer.approvals } } : answer
  }
  return answersByResumeKey
}

/** Heading and description of a question: the prompt's first line and the rest, or the step title. */
export function splitApprovalPrompt(approval: PendingApproval): { heading: string; description: string | null } {
  if (approval.toolCall) return { heading: `Allow ${approval.toolCall.tool ?? approval.toolCall.name}?`, description: approval.stepTitle ? `${approval.stepTitle} wants to use this tool` : 'The agent wants to use this tool' }
  const [firstLine, ...otherLines] = (approval.prompt ?? '').split('\n')
  const description = otherLines.join('\n').trim() || null
  if (firstLine.trim()) return { heading: firstLine.trim(), description }
  return { heading: approval.stepTitle ?? 'The run is waiting for you', description }
}
