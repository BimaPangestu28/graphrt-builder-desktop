import type { ApprovalAction, ApprovalField, ContainerPosition, PendingApproval } from './runReviewTypes'
import type { Run } from './types'

/**
 * Reads the questions of a paused run straight from its graphrt pause reasons, the same way
 * `src-tauri/src/run_review.rs` does (without the snapshot and flow details, which only the
 * backend can read). graphrt's `human-input` node pauses with kind `human_input` and
 * `data: { prompt, fields: [{ name, label, type, required, default }], actions: [{ id, title }], timeout_ms }`.
 */

const humanInputPauseKind = 'human_input'
const frameSegmentPattern = /^(.+)\[(\d+)\]$/

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

function readPendingApproval(rawReason: unknown): PendingApproval | null {
  const reason = asRecord(rawReason)
  const nodeId = readText(reason, 'node_id')
  if (!reason || !nodeId || reason.kind !== humanInputPauseKind) return null
  const frame = readText(reason, 'frame') ?? ''
  const data = asRecord(reason.data)
  const prompt = readText(data, 'prompt')
  return {
    nodeId,
    frame,
    resumeKey: buildResumeKey(frame, nodeId),
    stepTitle: null,
    prompt: prompt && prompt.trim() ? prompt : null,
    fields: readFields(data),
    actions: readActions(data),
    timeoutMs: typeof data?.timeout_ms === 'number' ? data.timeout_ms : null,
    container: readContainerFromFrame(frame),
  }
}

/**
 * The questions a paused run waits on, in pause order.
 *
 * @param run - The run, or null (Run | null)
 * @returns One entry per `human_input` pause reason; empty unless the run is paused (PendingApproval[])
 */
export function readPendingApprovals(run: Run | null): PendingApproval[] {
  if (run?.status !== 'paused') return []
  return (run.pauseReasons ?? []).map(readPendingApproval).filter((approval): approval is PendingApproval => approval !== null)
}
