import { useId, useState } from 'react'
import type { ApprovalAnswer, PendingApproval, PendingToolCall } from '@/api/runReviewTypes'
import { useNow } from '@/hooks/useNow'
import { ApprovalFieldInput } from './ApprovalFieldInput'
import { describeDeadline, describeToolName, formatToolArguments } from './approvalDisplay'
import { buildApprovalAnswer, findMissingRequiredFields, initialApprovalValues, splitApprovalPrompt, type ApprovalValues } from './approvalForm'
import { messages } from '@/i18n'
import { VisualBlock } from '@/components/visuals/VisualBlock'
import type { UiBlock } from '@/components/visuals/uiBlockTypes'

/** Whether the card replaces the form and buttons: an Adaptive Card with its own submit buttons. */
export function cardAnswersQuestion(card: UiBlock | null | undefined): boolean {
  if (!card || card.$ui !== 'adaptive_card') return false
  const json = JSON.stringify(card.card)
  return json.includes('"Action.Submit"') || json.includes('"Action.Execute"')
}

interface ApprovalCardProps {
  approval: PendingApproval
  onAnswer: (answer: ApprovalAnswer) => void
  /** True while the answer is being sent; every button is disabled. */
  isSubmitting?: boolean
}

/** How often the "Expires in…" line refreshes. */
const deadlineRefreshMs = 30 * 1000

const primaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-inverse hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButtonClassNames =
  'h-10 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

/** The tool, the agent's reason (when given) and the arguments as pretty JSON, secrets hidden. */
function ToolCallDetails({ toolCall }: { toolCall: PendingToolCall }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[13px] font-medium text-ink">{describeToolName(toolCall)}</span>
      {toolCall.reason && <p className="m-0 text-[13px] text-body">{toolCall.reason}</p>}
      <pre aria-label={messages().agentRun.toolArguments} className="m-0 max-h-64 overflow-auto rounded-[10px] border border-line bg-subtle px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
        {formatToolArguments(toolCall.arguments)}
      </pre>
    </div>
  )
}

/**
 * The amber card shown when a run pauses for the user. For an "Ask me before continuing" step it
 * shows exactly what the pause carries: the rendered prompt (first line as the title), the form
 * fields with their defaults (editable) and one button per action, the first one primary; every
 * action is disabled while a required field is empty, as graphrt would reject the answer. For a
 * tool call an agent waits to make it shows the tool and its arguments with Allow / Decline.
 * A step with a time limit shows the time left and what happens then.
 */
export function ApprovalCard({ approval, onAnswer, isSubmitting = false }: ApprovalCardProps) {
  const titleId = useId()
  const [values, setValues] = useState<ApprovalValues>(() => initialApprovalValues(approval))
  const now = useNow(approval.expiresAt !== null, deadlineRefreshMs)
  const { heading, description } = splitApprovalPrompt(approval)
  const missingFields = findMissingRequiredFields(approval, values)
  const isAnswerBlocked = missingFields.length > 0 || isSubmitting
  const deadline = describeDeadline(approval, now)
  const card = approval.card ?? null
  const cardAnswers = cardAnswersQuestion(card)

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3.5 rounded-2xl border-2 border-amber-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="m-0 text-[18px] font-semibold">
          {heading}
        </h2>
        {description && <span className="whitespace-pre-line text-[13px] text-body">{description}</span>}
        {deadline && <span className="text-[12px] font-medium text-amber-strong">{deadline}</span>}
      </div>
      {approval.toolCall && <ToolCallDetails toolCall={approval.toolCall} />}
      {card && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <VisualBlock
            block={card}
            bare
            answering={{ onSubmit: (submission) => onAnswer({ action: submission.action, values: submission.values }), answerActionIds: approval.actions.map((action) => action.id), isSubmitting }}
          />
        </div>
      )}
      {cardAnswers ? (
        <span className="text-[12px] text-muted">{messages().agentRun.pausedSafelyYouCanCloseThe}</span>
      ) : (
        <>
      {approval.fields.map((field) => (
        <ApprovalFieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(fieldValue) => setValues((currentValues) => ({ ...currentValues, [field.name]: fieldValue }))}
        />
      ))}
      {missingFields.length > 0 && <p className="m-0 text-[12px] text-amber-strong">{messages().agentRun.fillIn}{' '}{missingFields.join(', ')} {messages().agentRun.toAnswer}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {approval.actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onAnswer(buildApprovalAnswer(approval, action.id, values))}
            disabled={isAnswerBlocked}
            className={index === 0 ? primaryButtonClassNames : secondaryButtonClassNames}
          >
            {action.title}
          </button>
        ))}
        {approval.actions.length === 0 && <span className="text-[13px] text-body">{messages().agentRun.thisStepOffersNoAnswerTo}</span>}
        <span className="ml-auto text-[12px] text-muted">{messages().agentRun.pausedSafelyYouCanCloseThe}</span>
      </div>
        </>
      )}
    </section>
  )
}
