import { useState, type FormEvent } from 'react'
import { StrokeIcon, VisuallyHidden } from '@/components/ui'
import { coordinatorAcknowledgement, teamBudgetNote, teamGoalMessage, teamPlan } from '@/data/team'

interface ChatMessage {
  id: number
  author: 'user' | 'coordinator'
  text: string
}

function UserBubble({ text }: { text: string }) {
  return <div className="box-content max-w-[88%] self-end rounded-[14px_14px_4px_14px] bg-canvas px-3.5 py-3 leading-normal">{text}</div>
}

function CoordinatorPlan() {
  return (
    <div className="flex max-w-[94%] flex-col gap-2.5">
      <p className="m-0 leading-[1.55]">Plan for this week</p>
      <ol className="m-0 flex flex-col gap-2 pl-[18px] leading-normal text-ink-2">
        {teamPlan.map((planItem) => (
          <li key={planItem.memberName}>
            <b className="font-semibold text-ink">{planItem.memberName}</b> {planItem.task}
          </li>
        ))}
      </ol>
      <span className="text-[13px] text-body">{teamBudgetNote}</span>
    </div>
  )
}

/** Left column of screen 13: chat with the coordinator, starting from the goal and its weekly plan. */
export function CoordinatorChat() {
  const [draftMessage, setDraftMessage] = useState('')
  const [followUpMessages, setFollowUpMessages] = useState<ChatMessage[]>([])

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedMessage = draftMessage.trim()
    if (!trimmedMessage) return
    setFollowUpMessages((current) => [
      ...current,
      { id: current.length, author: 'user', text: trimmedMessage },
      { id: current.length + 1, author: 'coordinator', text: coordinatorAcknowledgement },
    ])
    setDraftMessage('')
  }

  return (
    <section aria-label="Talk to the coordinator" className="box-border flex min-w-0 flex-[1_1_340px] flex-col border-r border-line">
      <header className="box-border flex h-16 items-center gap-2.5 border-b border-line px-5">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">
          CO
        </span>
        <span className="flex flex-col">
          <span className="font-semibold">Coordinator</span>
          <span className="text-[12px] text-muted">Plans and hands out work</span>
        </span>
      </header>
      <div aria-live="polite" className="flex flex-auto flex-col gap-4 p-5">
        <UserBubble text={teamGoalMessage} />
        <CoordinatorPlan />
        {followUpMessages.map((message) =>
          message.author === 'user' ? (
            <UserBubble key={message.id} text={message.text} />
          ) : (
            <p key={message.id} className="m-0 max-w-[94%] leading-[1.55]">
              {message.text}
            </p>
          ),
        )}
      </div>
      <form onSubmit={sendMessage} className="px-5 pt-3 pb-5">
        <label htmlFor="coordinator-message">
          <VisuallyHidden>Message the coordinator</VisuallyHidden>
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-line-strong py-1.5 pr-1.5 pl-3.5">
          <input
            id="coordinator-message"
            type="text"
            placeholder="Change the goal or give feedback"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            className="h-9 min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
          />
          <button type="submit" aria-label="Send" className="flex size-9 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-ink text-white hover:bg-ink-2">
            <StrokeIcon size={16}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </StrokeIcon>
          </button>
        </div>
      </form>
    </section>
  )
}
