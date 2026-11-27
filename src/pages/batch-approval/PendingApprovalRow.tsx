import type { PendingApproval } from '@/api/runReviewTypes'
import { joinClassNames } from '@/components/ui'
import { ApprovalFieldInput } from '@/pages/agent-run/ApprovalFieldInput'
import { describeDeadline, formatToolArguments, summarizeToolArguments } from '@/pages/agent-run/approvalDisplay'
import type { ApprovalValues } from '@/pages/agent-run/approvalForm'
import { readablePrompt } from '@/pages/agent-run/readablePrompt'
import { buildRowMeta, buildRowTitle } from './runReviewModel'
import { messages } from '@/i18n'

interface PendingApprovalRowProps {
  approval: PendingApproval
  values: ApprovalValues
  chosenActionId: string
  /** When every question shares a yes/no pair, a checkbox picks between them; otherwise a select lists every action. */
  actionPair: [string, string] | null
  isEditing: boolean
  isLast: boolean
  onChooseAction: (actionId: string) => void
  onStartEditing: () => void
  onChangeValue: (fieldName: string, fieldValue: string | boolean) => void
}

const editingControlClassNames = 'rounded-[10px] border border-ink bg-surface px-3 py-2.5 text-[14px] leading-normal text-ink outline-none'

function previewText(approval: PendingApproval, values: ApprovalValues): string | null {
  if (approval.toolCall) return summarizeToolArguments(approval.toolCall.arguments)
  const [firstField] = approval.fields
  const firstValue = firstField ? values[firstField.name] : undefined
  if (typeof firstValue === 'string' && firstValue.trim()) return firstValue
  return approval.prompt
}

function ActionChoice({ approval, rowTitle, chosenActionId, actionPair, onChooseAction }: Pick<PendingApprovalRowProps, 'approval' | 'chosenActionId' | 'actionPair' | 'onChooseAction'> & { rowTitle: string }) {
  if (actionPair) {
    const [yesActionId, noActionId] = actionPair
    const yesTitle = approval.actions.find((action) => action.id === yesActionId)?.title ?? yesActionId
    return (
      <input
        type="checkbox"
        checked={chosenActionId === yesActionId}
        onChange={(event) => onChooseAction(event.target.checked ? yesActionId : noActionId)}
        aria-label={`${yesTitle}: ${rowTitle}`}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-ink"
      />
    )
  }
  return (
    <select
      value={chosenActionId}
      onChange={(event) => onChooseAction(event.target.value)}
      aria-label={messages().agentRun.answerFor(rowTitle)}
      className="h-8 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
    >
      {approval.actions.map((action) => (
        <option key={action.id} value={action.id}>
          {action.title}
        </option>
      ))}
    </select>
  )
}

/**
 * One pending question in the review list: the answer to give (checkbox or action list), the
 * item it is about, its deadline, and either a one-line preview of its first field (a tool call's
 * arguments) or (while editing) every form field of the question (the arguments as JSON).
 */
export function PendingApprovalRow(props: PendingApprovalRowProps) {
  const { approval, values, chosenActionId, actionPair, isEditing, isLast } = props
  const rowTitle = buildRowTitle(approval)
  const rowMeta = [buildRowMeta(approval), describeDeadline(approval, Date.now())].filter(Boolean).join(' · ')
  const isDeclined = actionPair !== null && chosenActionId !== actionPair[0]
  const preview = previewText(approval, values)
  const hasSingleField = approval.fields.length === 1

  return (
    <li className={joinClassNames('flex gap-3.5 px-4 py-3.5', isEditing && 'bg-subtle', !isLast && 'border-b border-chip')}>
      <ActionChoice approval={approval} rowTitle={rowTitle} chosenActionId={chosenActionId} actionPair={actionPair} onChooseAction={props.onChooseAction} />
      <div className={joinClassNames('flex min-w-0 flex-auto flex-col', isEditing ? 'gap-2' : 'gap-1')}>
        <span className="flex flex-wrap items-center gap-2">
          <b className={joinClassNames('font-semibold', isDeclined && 'text-body')}>{rowTitle}</b>
          {rowMeta && <span className="text-[12px] text-muted">{rowMeta}</span>}
          {isEditing && approval.fields.length > 0 && <span className="text-[12px] font-medium text-brand-strong">{messages().agentRun.editing}</span>}
        </span>
        {isEditing && approval.prompt && rowTitle !== approval.prompt && <span className="whitespace-pre-wrap text-[13px] text-body">{readablePrompt(approval.prompt)}</span>}
        {isEditing && approval.toolCall?.reason && <span className="text-[13px] text-body">{approval.toolCall.reason}</span>}
        {isEditing && approval.toolCall && (
          <pre aria-label={messages().agentRun.toolArgumentsFor(rowTitle)} className="m-0 max-h-56 overflow-auto rounded-[10px] border border-line bg-surface px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-ink-2">
            {formatToolArguments(approval.toolCall.arguments)}
          </pre>
        )}
        {isEditing &&
          approval.fields.map((field, fieldIndex) => (
            <ApprovalFieldInput
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(fieldValue) => props.onChangeValue(field.name, fieldValue)}
              ariaLabel={messages().agentRun.fieldFor(field.label, rowTitle)}
              isLabelHidden={hasSingleField}
              controlClassName={editingControlClassNames}
              autoFocus={fieldIndex === 0}
            />
          ))}
        {!isEditing && preview && (
          <button
            type="button"
            onClick={props.onStartEditing}
            aria-label={approval.toolCall ? messages().agentRun.showArgumentsFor(rowTitle) : messages().agentRun.editAnswerFor(rowTitle)}
            className={joinClassNames(
              'cursor-text truncate border-0 bg-transparent p-0 text-left text-[14px] leading-normal hover:underline',
              isDeclined ? 'text-muted' : 'text-ink-2',
            )}
          >
            {preview}
          </button>
        )}
      </div>
    </li>
  )
}
