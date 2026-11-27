import { ModelPickerChip } from '@/pages/new-agent/ModelPickerChip'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { splitPaneColumnClassName, splitPaneScrollClassName } from '@/components/layout'
import { useFollowNewContent } from '@/hooks/useFollowNewContent'
import type { Agent, BuilderMessage, FlowStep } from '@/api/types'
import { joinClassNames, StrokeIcon, VisuallyHidden } from '@/components/ui'
import { BuilderExplanation } from './BuilderExplanation'
import { assistantBlockClassNames, PanelHeader, UserChatBubble } from './ChatBubbles'
import { describeDraftActivity } from './draftActivity'
import type { BuilderAskDraft } from './useBuilderAskDraft'
import { CompactDraftStepList } from './DraftPreviewParts'
import { NodesEditNotice } from './nodes/sync/NodesEditNotice'
import { SavedChatMessages } from './SavedChatMessages'
import type { ChatExchange, LatestRevision } from './useAgentRevisions'
import type { PluginSetupAnchor } from './usePluginSetupPlacement'
import { messages } from '@/i18n'

const outlineButtonClassNames =
  'h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50'

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

interface AgentSummaryReplyProps {
  agentId: string
  agentName: string
  steps: FlowStep[]
  /** The model's explanation of the agent when it was built, saved with the chat. */
  openingExplanation: string | null
}

/** First assistant reply: the build's explanation (when saved) and a summary of the agent's current steps. */
function AgentSummaryReply({ agentId, agentName, steps, openingExplanation }: AgentSummaryReplyProps) {
  const approvalCount = steps.filter((flowStep) => flowStep.needsApproval).length
  const stepCountLabel = pluralize(steps.length, 'step', 'steps')
  return (
    <div className={`${assistantBlockClassNames} gap-3`}>
      {openingExplanation && <BuilderExplanation text={openingExplanation} agentId={agentId} />}
      <p className="m-0 leading-[1.55]">
        {messages().builder.yourAgentHas}{' '}{stepCountLabel}.{approvalCount > 0 ? messages().builder.itAsksYouBeforeAnythingThat : messages().builder.itRunsWithoutStoppingForApproval}
      </p>
      <div className="flex flex-col gap-2.5 rounded-xl border border-line px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{agentName}</span>
          <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-medium text-brand-strong">{messages().builder.checked}</span>
        </div>
        <span className="text-[13px] text-body">
          {stepCountLabel} · {pluralize(approvalCount, 'approval', 'approvals')}
        </span>
      </div>
    </div>
  )
}

interface ChangeReplyProps {
  /** The agent changed, for the "Trust <host> for lookups" buttons. */
  agentId: string | null
  exchange: ChatExchange
  steps: FlowStep[]
  /** Present only on the latest successful change, which can be undone. */
  undoableRevision: LatestRevision | null
  isBusy: boolean
  onToggleUndo: () => void
  /** Stops the change while it runs. */
  onStop?: () => void
  isStopping: boolean
}

/**
 * The builder's reply while a change runs: the model's explanation as it streams (or the
 * stage message until text arrives), a quiet token count while it writes, and the step
 * titles written so far. The chat column is a polite live region, so the streamed parts
 * opt out of it (`aria-live="off"`) and screen readers hear stage changes and the final
 * reply instead of every token.
 */
function LiveChangeReply({ exchange, onStop, isStopping }: { exchange: ChatExchange; onStop?: () => void; isStopping: boolean }) {
  const hasExplanation = exchange.explanation.trim().length > 0
  const activity = exchange.writingStage && exchange.draft ? describeDraftActivity(exchange.writingStage, exchange.draft.outputTokens) : null
  const stopButton = onStop && (
    <button type="button" onClick={onStop} disabled={isStopping} className={`${outlineButtonClassNames} h-7 shrink-0 px-2.5 text-[12px]`}>
      {isStopping ? messages().builder.stopping : messages().builder.stop}
    </button>
  )
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      {hasExplanation ? (
        <>
          <VisuallyHidden>{exchange.reply}</VisuallyHidden>
          {stopButton && <div className="flex justify-end">{stopButton}</div>}
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 leading-[1.55] text-body">{exchange.reply}</p>
          {stopButton}
        </div>
      )}
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
  return messages().builder.undoneBackToVVersionbefore(undoableRevision.versionBefore)
}

/** Reply to a change request: progress, the explanation and summary with changed steps, and Undo/Redo. */
function ChangeReply({ agentId, exchange, steps, undoableRevision, isBusy, onToggleUndo, onStop, isStopping }: ChangeReplyProps) {
  if (exchange.status === 'pending') return <LiveChangeReply exchange={exchange} onStop={onStop} isStopping={isStopping} />
  if (exchange.status === 'stopped') return <p className="m-0 max-w-[92%] leading-[1.55] text-muted">{exchange.reply}</p>
  if (exchange.status === 'failed') return <p className="m-0 max-w-[92%] leading-[1.55] text-danger">{exchange.reply}</p>
  const changedSteps = steps.filter((flowStep) => exchange.changedStepIds.includes(flowStep.id))
  const isUndone = undoableRevision?.isUndone ?? false
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      {undoableRevision && isUndone ? (
        <p className="m-0 leading-[1.55]">{describeUndone(undoableRevision)}</p>
      ) : (
        <>
          {exchange.explanation && <BuilderExplanation text={exchange.explanation} agentId={agentId} />}
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
            {isUndone ? messages().builder.redo : messages().builder.undo}
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

  function sendRequest() {
    const trimmedRequest = draftRequest.trim()
    if (!trimmedRequest || isBusy) return
    onSubmitRequest(trimmedRequest)
    setDraftRequest('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    sendRequest()
  }

  /** Enter sends, like a chat; Shift+Enter starts a new line. Enter that confirms an input-method word is left alone. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    sendRequest()
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 pt-4 pb-6">
      <label htmlFor="prompt" className="sr-only">
        {messages().builder.describeAChange}
      </label>
      <div className="flex items-end gap-3 rounded-[14px] border border-line-strong py-3 pr-3 pl-4">
        <textarea
          ref={promptRef}
          id="prompt"
          rows={2}
          value={draftRequest}
          onChange={(event) => setDraftRequest(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={messages().builder.describeAChangeLikeSkipPlaces}
          className="flex-auto resize-none border-0 bg-transparent text-[14px] text-ink outline-none"
        />
        <button
          type="submit"
          aria-label={messages().builder.send}
          disabled={!draftRequest.trim() || isBusy}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-ink text-inverse hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
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
  /** The build's explanation saved on an earlier visit, shown in the first reply. */
  openingExplanation: string | null
  /** Builder chat saved on earlier visits, shown before this visit's exchanges. */
  savedMessages: BuilderMessage[]
  exchanges: ChatExchange[]
  latestRevision: LatestRevision | null
  isBusy: boolean
  undoErrorMessage: string | null
  onSubmitRequest: (request: string) => void
  onToggleUndo: () => void
  /** "Stop" next to "Working on it…": cancels the change in progress. */
  onStopRequest?: () => void
  /** True between Stop and the change ending. */
  isStopping?: boolean
  /** The plugin setup message, shown at `pluginSetupAnchor`. */
  pluginSetupMessage?: ReactNode
  /** "opening": first builder message · exchange id: under that revision's reply · null: not shown. */
  pluginSetupAnchor?: PluginSetupAnchor | null
  /** Request to prefill in the prompt box (from the `ask` search param), left for the user to send. */
  askDraft?: BuilderAskDraft | null
  /**
   * Column width: `wide` shares the page with the agent (Steps), `narrow` is the fixed
   * 360px column of the Nodes view (spec A), `rail` folds it to a thin strip.
   */
  layout?: ChatPanelLayout
  /** Folds or opens the chat (Nodes view); without it there is no fold button. */
  onToggleCollapsed?: () => void
}

/** How wide the chat column is drawn. */
export type ChatPanelLayout = 'wide' | 'narrow' | 'rail'

const chatColumnWidthClassNames: Record<ChatPanelLayout, string> = {
  wide: 'flex-[1_1_380px]',
  narrow: 'flex-[0_0_360px]',
  rail: 'flex-[0_0_52px]',
}

const railButtonClassNames = 'flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 hover:bg-subtle'

/** The folded chat: open it, or open it straight into the prompt box. */
function ChatRail({ onExpand, onWrite }: { onExpand: () => void; onWrite: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1 py-3.5">
      <button type="button" aria-label={messages().builder.showTheChat} title={messages().builder.showTheChat} aria-expanded="false" onClick={onExpand} className={railButtonClassNames}>
        <StrokeIcon size={16}>
          <path d="M9 6l6 6-6 6" />
        </StrokeIcon>
      </button>
      <button type="button" aria-label={messages().builder.describeAChange} title={messages().builder.describeAChange} onClick={onWrite} className={railButtonClassNames}>
        <StrokeIcon size={16}>
          <path d="M4 5h16v11H9l-5 4z" />
        </StrokeIcon>
      </button>
    </div>
  )
}

/** Left column of screen 04: the build conversation plus a box to ask for more changes. */
export function BuilderChatPanel(props: BuilderChatPanelProps) {
  const { agent, steps, openingExplanation, savedMessages, exchanges, latestRevision, isBusy, undoErrorMessage, onSubmitRequest, onToggleUndo, onStopRequest, isStopping = false, pluginSetupMessage, pluginSetupAnchor, askDraft } = props
  const { layout = 'wide', onToggleCollapsed } = props
  const chatBodyRef = useFollowNewContent()
  const sectionRef = useRef<HTMLElement>(null)
  const isRail = layout === 'rail'
  // Folded, the conversation stays mounted (hidden) so a half-written request survives.
  function expandAndFocusPrompt() {
    onToggleCollapsed?.()
    window.setTimeout(() => sectionRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0)
  }
  return (
    <section
      ref={sectionRef}
      aria-label={messages().builder.chat}
      data-layout={layout}
      className={joinClassNames('box-border flex min-w-0 flex-col border-r border-line bg-surface transition-[flex-basis] duration-200 motion-reduce:transition-none', chatColumnWidthClassNames[layout], splitPaneColumnClassName)}
    >
      {isRail && onToggleCollapsed && <ChatRail onExpand={onToggleCollapsed} onWrite={expandAndFocusPrompt} />}
      <PanelHeader className={joinClassNames('justify-between gap-2', layout === 'narrow' && 'px-5', isRail && 'hidden')}>
        <span className="flex min-w-0 items-center gap-1.5">
          {onToggleCollapsed && (
            <button type="button" aria-label={messages().builder.hideTheChat} title={messages().builder.hideTheChat} aria-expanded="true" onClick={onToggleCollapsed} className={joinClassNames(railButtonClassNames, '-ml-2 size-8')}>
              <StrokeIcon size={16}>
                <path d="M15 6l-6 6 6 6" />
              </StrokeIcon>
            </button>
          )}
          <span className="truncate font-semibold">{messages().builder.buildWithChat}</span>
        </span>
        <ModelPickerChip label={messages().builder.modelTheBuilderUses} />
      </PanelHeader>
      <div ref={chatBodyRef} aria-live="polite" className={joinClassNames('flex flex-auto flex-col gap-5', layout === 'narrow' ? 'p-5' : 'p-6', splitPaneScrollClassName, isRail && 'hidden')}>
        {agent && (
          <>
            <UserChatBubble>{agent.description}</UserChatBubble>
            <AgentSummaryReply agentId={agent.id} agentName={agent.name} steps={steps} openingExplanation={openingExplanation} />
            {pluginSetupAnchor === 'opening' && pluginSetupMessage}
            <SavedChatMessages agentId={agent.id} messages={savedMessages} />
          </>
        )}
        {exchanges.map((exchange) => {
          const undoableRevision = latestRevision?.exchangeId === exchange.id ? latestRevision : null
          if (exchange.source === 'nodes') {
            return (
              <NodesEditNotice
                key={exchange.id}
                summary={exchange.reply}
                versionAfter={exchange.versionAfter ?? 0}
                versionBefore={undoableRevision?.versionBefore ?? 0}
                isUndone={undoableRevision ? undoableRevision.isUndone : null}
                isBusy={isBusy}
                onToggleUndo={onToggleUndo}
              />
            )
          }
          return (
            <div key={exchange.id} className="flex flex-col gap-5">
              <UserChatBubble>{exchange.request}</UserChatBubble>
              <ChangeReply agentId={agent?.id ?? null} exchange={exchange} steps={steps} undoableRevision={undoableRevision} isBusy={isBusy} onToggleUndo={onToggleUndo} onStop={onStopRequest} isStopping={isStopping} />
              {pluginSetupAnchor === exchange.id && exchange.status !== 'pending' && pluginSetupMessage}
            </div>
          )
        })}
        {undoErrorMessage && (
          <p role="alert" className="m-0 text-danger">
            {undoErrorMessage}
          </p>
        )}
      </div>
      <div className={isRail ? 'hidden' : undefined}>
        <ChangeRequestForm isBusy={isBusy || !agent} onSubmitRequest={onSubmitRequest} askDraft={askDraft} />
      </div>
    </section>
  )
}
