import { useState, type FormEvent } from 'react'
import { StrokeIcon } from '@/components/ui'
import { mapsLeadsAgentName, mapsLeadsJobDescription } from '@/data/mapsLeadsAgent'
import { PanelHeader, UserChatBubble } from './ChatBubbles'

/** A message typed after the screen opened, with its mocked assistant reply. */
interface FollowUpExchange {
  id: number
  request: string
  reply: string
}

const mockedFollowUpReply = 'Got it. I will apply that change and check the steps again before your next test'

const assistantBlockClassNames = 'flex max-w-[92%] flex-col'
const outlineButtonClassNames =
  'h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle'

/** First assistant reply: summary of the generated agent. */
function AgentSummaryReply() {
  return (
    <div className={`${assistantBlockClassNames} gap-3`}>
      <p className="m-0 leading-[1.55]">Your agent has 6 steps. It asks you before every message, and it needs WhatsApp connected on this Mac before the first run</p>
      <div className="flex flex-col gap-2.5 rounded-xl border border-line px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{mapsLeadsAgentName}</span>
          <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-medium text-brand-strong">Checked</span>
        </div>
        <span className="text-[13px] text-body">6 steps · 1 approval · about $0.01 per place</span>
      </div>
    </div>
  )
}

/** Reply to "make the message shorter…", listing changed steps with an Undo/Redo toggle. */
function StepChangesReply({ isUndone, onToggleUndo }: { isUndone: boolean; onToggleUndo: () => void }) {
  return (
    <div className={`${assistantBlockClassNames} gap-2.5`}>
      <p className="m-0 leading-[1.55]">{isUndone ? 'Undone. Steps 4 and 6 are back to how they were' : 'Done. Two steps changed'}</p>
      <div className="flex flex-col gap-1.5">
        <span className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px]">
          <b className="font-semibold">Write message</b> · max 2 sentences
        </span>
        <span className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px]">
          <b className="font-semibold">Send WhatsApp</b> · 30s gap between messages
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onToggleUndo} className={outlineButtonClassNames}>
          {isUndone ? 'Redo' : 'Undo'}
        </button>
      </div>
    </div>
  )
}

/** Prompt box at the bottom of the chat column. */
function ChangeRequestForm({ onSubmitRequest }: { onSubmitRequest: (request: string) => void }) {
  const [draftRequest, setDraftRequest] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedRequest = draftRequest.trim()
    if (!trimmedRequest) return
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
          disabled={!draftRequest.trim()}
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
  isLastChangeUndone: boolean
  onToggleUndo: () => void
}

/** Left column of screen 04: the build conversation plus a box to ask for more changes. */
export function BuilderChatPanel({ isLastChangeUndone, onToggleUndo }: BuilderChatPanelProps) {
  const [followUpExchanges, setFollowUpExchanges] = useState<FollowUpExchange[]>([])

  function addFollowUpExchange(request: string) {
    setFollowUpExchanges((exchanges) => [...exchanges, { id: exchanges.length + 1, request, reply: mockedFollowUpReply }])
  }

  return (
    <section aria-label="Chat" className="box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface">
      <PanelHeader className="justify-between">
        <span className="font-semibold">Build with chat</span>
        <span className="text-[12px] text-muted">gpt-4o-mini</span>
      </PanelHeader>
      <div aria-live="polite" className="flex flex-auto flex-col gap-5 p-6">
        <UserChatBubble>{mapsLeadsJobDescription}</UserChatBubble>
        <AgentSummaryReply />
        <UserChatBubble>Make the message shorter and wait 30 seconds between messages</UserChatBubble>
        <StepChangesReply isUndone={isLastChangeUndone} onToggleUndo={onToggleUndo} />
        {followUpExchanges.map((exchange) => (
          <div key={exchange.id} className="flex flex-col gap-5">
            <UserChatBubble>{exchange.request}</UserChatBubble>
            <p className="m-0 max-w-[92%] leading-[1.55]">{exchange.reply}</p>
          </div>
        ))}
      </div>
      <ChangeRequestForm onSubmitRequest={addFollowUpExchange} />
    </section>
  )
}
