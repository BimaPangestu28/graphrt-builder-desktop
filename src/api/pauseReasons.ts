import type { ApprovalAction, ApprovalField, ContainerPosition, PendingApproval, PendingToolCall, TimeoutAction } from './runReviewTypes'
import { redactSecrets } from './secretRedaction'
import type { Run } from './types'
import { messages } from '@/i18n'

/**
 * Reads the questions of a paused run straight from its graphrt pause reasons, the same way
 * `src-tauri/src/run_review.rs` does (without the snapshot and flow details, which only the
 * backend can read). graphrt's `human-input` node pauses with kind `human_input` and
 * `data: { prompt, fields: [{ name, label, type, required, default }], actions: [{ id, title }], timeout_ms }`;
 * the desktop adds `expires_at` and `on_timeout` when the step has a time limit. An agent step whose
 * tools ask first pauses with kind `tool_approval` and `data: { calls: [{ id, name, arguments }] }`
 * (the desktop adds `provider` / `tool`); each call becomes one Allow / Decline question.
 */

const humanInputPauseKind = 'human_input'
const toolApprovalPauseKind = 'tool_approval'
const frameSegmentPattern = /^(.+)\[(\d+)\]$/

/** Action id of the Allow button of a tool call question. */
export const allowActionId = 'allow'

/** The two buttons of a tool call question. */
export const toolCallActions: ApprovalAction[] = [
  {
    id: allowActionId,
    get title() {
      return messages().lib.allow
    },
  },
  {
    id: 'decline',
    get title() {
      return messages().lib.decline
    },
  },
]

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readText(record: JsonRecord | null, key: string): string | null {
  const fieldValue = record?.[key]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function readFields(data: JsonRecord | null): ApprovalField[] {
  const rawFields = Array.isArray(data?.fields) ? data.fields : []
  return rawFields.flatMap((rawField): ApprovalField[] => {
    const field = asRecord(rawField)
    const name = readText(field, 'name')
    if (!field || !name) return []
    return [
      {
        name,
        label: readText(field, 'label') ?? name,
        fieldType: readText(field, 'type') ?? 'text',
        required: field.required === true,
        defaultValue: field.default ?? null,
      },
    ]
  })
}

function readActions(data: JsonRecord | null): ApprovalAction[] {
  const rawActions = Array.isArray(data?.actions) ? data.actions : []
  return rawActions.flatMap((rawAction): ApprovalAction[] => {
    const id = readText(asRecord(rawAction), 'id')
    return id ? [{ id, title: readText(asRecord(rawAction), 'title') ?? id }] : []
  })
}

/** `"outer[1]/each[3]"` → the innermost container (`each`, index 3); null at the top level. */
export function readContainerFromFrame(frame: string): ContainerPosition | null {
  const innermostSegment = frame.split('/').pop() ?? ''
  const match = frameSegmentPattern.exec(innermostSegment)
  if (!match) return null
  return { nodeId: match[1], nodeType: null, title: null, index: Number(match[2]), total: null, finished: null, item: null }
}

/** `resumeRun` key of a node: frame-qualified inside containers, the plain node id at the top level. */
export function buildResumeKey(frame: string, nodeId: string): string {
  return frame ? `${frame}/${nodeId}` : nodeId
}

/** `{ kind: 'stop' }` or `{ kind: 'answer', action }` from a stored `on_timeout`; null otherwise. */
export function readTimeoutAction(rawChoice: unknown): TimeoutAction | null {
  const choice = asRecord(rawChoice)
  if (choice?.kind === 'stop') return { kind: 'stop' }
  const action = readText(choice, 'action')
  return choice?.kind === 'answer' && action ? { kind: 'answer', action } : null
}

function readFormApproval(reason: JsonRecord, nodeId: string): PendingApproval {
  const frame = readText(reason, 'frame') ?? ''
  const data = asRecord(reason.data)
  const prompt = readText(data, 'prompt')
  const resumeKey = buildResumeKey(frame, nodeId)
  return {
    id: resumeKey,
    kind: 'form',
    nodeId,
    frame,
    resumeKey,
    stepTitle: null,
    prompt: prompt && prompt.trim() ? prompt : null,
    fields: readFields(data),
    actions: readActions(data),
    timeoutMs: typeof data?.timeout_ms === 'number' ? data.timeout_ms : null,
    expiresAt: readText(reason, 'expires_at'),
    onTimeout: readTimeoutAction(reason.on_timeout),
    toolCall: null,
    container: readContainerFromFrame(frame),
  }
}

function readToolCall(rawCall: unknown): PendingToolCall | null {
  const call = asRecord(rawCall)
  const callId = readText(call, 'id')
  if (!call || !callId) return null
  return {
    callId,
    name: readText(call, 'name') ?? callId,
    provider: readText(call, 'provider'),
    tool: readText(call, 'tool'),
    arguments: redactSecrets(call.arguments ?? null),
    reason: readText(call, 'reason'),
  }
}

function readToolCallApprovals(reason: JsonRecord, nodeId: string): PendingApproval[] {
  const frame = readText(reason, 'frame') ?? ''
  const resumeKey = buildResumeKey(frame, nodeId)
  const rawCalls = asRecord(reason.data)?.calls
  const toolCalls = (Array.isArray(rawCalls) ? rawCalls : []).map(readToolCall).filter((call): call is PendingToolCall => call !== null)
  return toolCalls.map((toolCall) => ({
    id: `${resumeKey}#${toolCall.callId}`,
    kind: 'toolCall',
    nodeId,
    frame,
    resumeKey,
    stepTitle: null,
    prompt: null,
    fields: [],
    actions: toolCallActions,
    timeoutMs: null,
    expiresAt: null,
    onTimeout: null,
    toolCall,
    container: readContainerFromFrame(frame),
  }))
}

function readQuestionsOfReason(rawReason: unknown): PendingApproval[] {
  const reason = asRecord(rawReason)
  const nodeId = readText(reason, 'node_id')
  if (!reason || !nodeId) return []
  if (reason.kind === humanInputPauseKind) return [readFormApproval(reason, nodeId)]
  if (reason.kind === toolApprovalPauseKind) return readToolCallApprovals(reason, nodeId)
  return []
}

/**
 * The questions a paused run waits on, in pause order.
 *
 * @param run - The run, or null (Run | null)
 * @returns One entry per `human_input` pause reason and per call of a `tool_approval` one; empty
 *   unless the run is paused (PendingApproval[])
 */
export function readPendingApprovals(run: Run | null): PendingApproval[] {
  if (run?.status !== 'paused') return []
  return (run.pauseReasons ?? []).flatMap(readQuestionsOfReason)
}
