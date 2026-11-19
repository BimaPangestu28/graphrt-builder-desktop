import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { splitPaneColumnClassName, splitPaneScrollClassName } from '@/components/layout'
import { useFollowNewContent } from '@/hooks/useFollowNewContent'
import type { Agent, FlowStep } from '@/api/types'
import { StrokeIcon, VisuallyHidden } from '@/components/ui'
import { PanelHeader, UserChatBubble } from './ChatBubbles'
import { describeDraftActivity } from './draftActivity'
import type { BuilderAskDraft } from './useBuilderAskDraft'
import { CompactDraftStepList } from './DraftPreviewParts'
import type { ChatExchange, LatestRevision } from './useAgentRevisions'
import type { PluginSetupAnchor } from './usePluginSetupPlacement'

const assistantBlockClassNames = 'flex max-w-[92%] flex-col'
const outlineButtonClassNames =
  'h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** First assistant reply: summary of the agent's current steps. */
function AgentSummaryReply({ agentName, steps }: { agentName: string; steps: FlowStep[] }) {
  const approvalCount = steps.filter((flowStep) => flowStep.needsApproval).length
  const stepCountLabel = pluralize(steps.length, 'step', 'steps')
  return (
    <div className={`${assistantBlockClassNames} gap-3`}>
      <p className="m-0 leading-[1.55]">
        Your agent has {stepCountLabel}.{approvalCount > 0 ? ' It asks you before anything that needs your approval' : ' It runs without stopping for approval'}
      </p>
      <div className="flex flex-col gap-2.5 rounded-xl border border-line px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{agentName}</span>
          <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-medium text-brand-strong">Checked</span>
        </div>
        <span className="text-[13px] text-body">
          {stepCountLabel} · {pluralize(approvalCount, 'approval', 'approvals')}
        </span>
      </div>
    </div>
  )
}

interface ChangeReplyProps {
  exchange: ChatExchange
  steps: FlowStep[]
  /** Present only on the latest successful change, which can be undone. */
  undoableRevision: LatestRevision | null
  isBusy: boolean
  onToggleUndo: () => void
}

/**
 * The builder's reply while a change runs: the model's explanation as it streams (or the
 * stage message until text arrives), a quiet token count while it writes, and the step
 * titles written so far. The chat column is a polite live region, so the streamed parts
 * opt out of it (`aria-live="off"`) and screen readers hear stage changes and the final
 * reply instead of every token.
 */
function LiveChangeReply({ exchange }: { exchange: ChatExchange }) {
  const hasExplanation = exchange.explanation.trim().length > 0
  const activity = exchange.writingStage && exchange.draft ? describeDraftActivity(exchange.writingStage, exchange.draft.outputTokens) : null
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      {hasExplanation ? <VisuallyHidden>{exchange.reply}</VisuallyHidden> : <p className="m-0 leading-[1.55] text-body">{exchange.reply}</p>}
      {(hasExplanation || exchange.draft) && (
        <div aria-live="off" className="flex flex-col gap-2.5">
          {hasExplanation && <p className="m-0 leading-[1.55]">{exchange.explanation}</p>}
          {activity && (
            <span aria-hidden="true" className="text-[12px] text-muted tabular-nums">
              {activity}
            </span>
          )}
          <CompactDraftStepList stepTitles={exchange.draft?.stepTitles ?? []} />
        </div>
      )}
    </div>
  )
}

function describeUndone(undoableRevision: LatestRevision): string {
  return `Undone. Back to v${undoableRevision.versionBefore}`
}

/** Reply to a change request: progress, the explanation and summary with changed steps, and Undo/Redo. */
function ChangeReply({ exchange, steps, undoableRevision, isBusy, onToggleUndo }: ChangeReplyProps) {
  if (exchange.status === 'pending') return <LiveChangeReply exchange={exchange} />
  if (exchange.status === 'failed') return <p className="m-0 max-w-[92%] leading-[1.55] text-danger">{exchange.reply}</p>
  const changedSteps = steps.filter((flowStep) => exchange.changedStepIds.includes(flowStep.id))
  const isUndone = undoableRevision?.isUndone ?? false
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      {undoableRevision && isUndone ? (
        <p className="m-0 leading-[1.55]">{describeUndone(undoableRevision)}</p>
      ) : (
        <>
          {exchange.explanation && <p className="m-0 leading-[1.55]">{exchange.explanation}</p>}
          <p className="m-0 leading-[1.55]">{exchange.reply}</p>
        </>
      )}
      {!isUndone && changedSteps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {changedSteps.map((flowStep) => (
            <span key={flowStep.id} className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px]">
              <b className="font-semibold">{flowStep.title}</b> · {flowStep.detail}
            </span>
          ))}
        </div>
      )}
      {undoableRevision && (
        <div className="flex gap-2">
          <button type="button" onClick={onToggleUndo} disabled={isBusy} className={outlineButtonClassNames}>
            {isUndone ? 'Redo' : 'Undo'}
          </button>
        </div>
      )}
    </div>
  )
}

interface ChangeRequestFormProps {
  isBusy: boolean
  onSubmitRequest: (request: string) => void
  /** Request to put in the box for the user to review and send (never sent by itself). */
  askDraft?: BuilderAskDraft | null
}

/** Prompt box at the bottom of the chat column. */
function ChangeRequestForm({ isBusy, onSubmitRequest, askDraft }: ChangeRequestFormProps) {
  const [draftRequest, setDraftRequest] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!askDraft) return
    setDraftRequest(askDraft.text)
    promptRef.current?.focus()
  }, [askDraft])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedRequest = draftRequest.trim()
    if (!trimmedRequest || isBusy) return
    onSubmitRequest(trimmedRequest)
    setDraftRequest('')
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 pt-4 pb-6">
      <label htmlFor="prompt" className="sr-only">
        Describe a change
      </label>
      <div className="flex items-end gap-3 rounded-[14px] border border-line-strong py-3 pr-3 pl-4">
        <textarea
          ref={promptRef}
          id="prompt"
          rows={2}
          value={draftRequest}
          onChange={(event) => setDraftRequest(event.target.value)}
          placeholder="Describe a change, like “skip places with fewer than 50 reviews”"
          className="flex-auto resize-none border-0 bg-transparent text-[14px] text-ink outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draftRequest.trim() || isBusy}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-ink text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StrokeIcon size={18}>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </StrokeIcon>
        </button>
      </div>
    </form>
  )
}

interface BuilderChatPanelProps {
  agent: Agent | null
  steps: FlowStep[]
  modelName: string | null
  exchanges: ChatExchange[]
  latestRevision: LatestRevision | null
  isBusy: boolean
  undoErrorMessage: string | null
  onSubmitRequest: (request: string) => void
  onToggleUndo: () => void
  /** The plugin setup message, shown at `pluginSetupAnchor`. */
  pluginSetupMessage?: ReactNode
  /** "opening": first builder message · exchange id: under that revision's reply · null: not shown. */
  pluginSetupAnchor?: PluginSetupAnchor | null
  /** Request to prefill in the prompt box (from the `ask` search param), left for the user to send. */
  askDraft?: BuilderAskDraft | null
}

/** Left column of screen 04: the build conversation plus a box to ask for more changes. */
export function BuilderChatPanel(props: BuilderChatPanelProps) {
  const { agent, steps, modelName, exchanges, latestRevision, isBusy, undoErrorMessage, onSubmitRequest, onToggleUndo, pluginSetupMessage, pluginSetupAnchor, askDraft } = props
  const chatBodyRef = useFollowNewContent()
  return (
    <section aria-label="Chat" className={`box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface ${splitPaneColumnClassName}`}>
      <PanelHeader className="justify-between">
        <span className="font-semibold">Build with chat</span>
        {modelName && <span className="text-[12px] text-muted">{modelName}</span>}
      </PanelHeader>
      <div ref={chatBodyRef} aria-live="polite" className={`flex flex-auto flex-col gap-5 p-6 ${splitPaneScrollClassName}`}>
        {agent && (
          <>
            <UserChatBubble>{agent.description}</UserChatBubble>
            <AgentSummaryReply agentName={agent.name} steps={steps} />
            {pluginSetupAnchor === 'opening' && pluginSetupMessage}
          </>
        )}
        {exchanges.map((exchange) => (
          <div key={exchange.id} className="flex flex-col gap-5">
            <UserChatBubble>{exchange.request}</UserChatBubble>
            <ChangeReply
              exchange={exchange}
              steps={steps}
              undoableRevision={latestRevision?.exchangeId === exchange.id ? latestRevision : null}
              isBusy={isBusy}
              onToggleUndo={onToggleUndo}
            />
            {pluginSetupAnchor === exchange.id && exchange.status !== 'pending' && pluginSetupMessage}
          </div>
        ))}
        {undoErrorMessage && (
          <p role="alert" className="m-0 text-danger">
            {undoErrorMessage}
          </p>
        )}
      </div>
      <ChangeRequestForm isBusy={isBusy || !agent} onSubmitRequest={onSubmitRequest} askDraft={askDraft} />
    </section>
  )
}
