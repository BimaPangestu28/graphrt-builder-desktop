import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CoordinatorExchange } from '@/api/teamTypes'
import { StrokeIcon, VisuallyHidden } from '@/components/ui'
import { agentPath } from '@/routes'
import { messages } from '@/i18n'

function UserBubble({ text }: { text: string }) {
  return <div className="box-content max-w-[88%] self-end rounded-[14px_14px_4px_14px] bg-canvas px-3.5 py-3 leading-normal">{text}</div>
}

function ReplyStatus({ exchange, teamAgentId }: { exchange: CoordinatorExchange; teamAgentId: string }) {
  switch (exchange.status) {
    case 'running':
      return <p className="m-0 text-[13px] text-muted">{messages().team.workingOnIt}</p>
    case 'paused':
      return (
        <Link to={agentPath('testRun', teamAgentId, { runId: exchange.runId })} className="text-[13px] font-medium">
          {messages().team.waitingForYouOpenTheRun}
        </Link>
      )
    case 'failed':
      return <p className="m-0 text-[13px] text-amber-strong">{messages().team.stopped}{' '}{exchange.errorMessage ?? messages().team.somethingWentWrong2}</p>
    case 'aborted':
      return <p className="m-0 text-[13px] text-muted">{messages().team.stopped2}</p>
    default:
      return null
  }
}

/** The coordinator's side of one exchange: its reply, the member calls of the run and a note. */
function CoordinatorReply({ exchange, teamAgentId }: { exchange: CoordinatorExchange; teamAgentId: string }) {
  return (
    <div className="flex max-w-[94%] flex-col gap-2.5">
      {exchange.replyText && <p className="m-0 leading-[1.55] whitespace-pre-line">{exchange.replyText}</p>}
      <ReplyStatus exchange={exchange} teamAgentId={teamAgentId} />
      {exchange.memberCalls.length > 0 && (
        <ol className="m-0 flex flex-col gap-2 pl-[18px] leading-normal text-ink-2">
          {exchange.memberCalls.map((memberCall, index) => (
            <li key={index}>
              <b className="font-semibold text-ink">{memberCall.memberName}</b> {memberCall.task}
              {memberCall.status === 'failed' && <span className="text-amber-strong"> {messages().team.failed}</span>}
              {memberCall.status === 'working' && <span className="text-muted"> {messages().team.working2}</span>}
            </li>
          ))}
        </ol>
      )}
      {exchange.note && <span className="text-[13px] text-body">{exchange.note}</span>}
    </div>
  )
}

interface CoordinatorChatProps {
  teamAgentId: string
  exchanges: CoordinatorExchange[] | null
  onSend: (message: string) => Promise<void>
}

/**
 * Left column of screen 13: talk to the coordinator. Every message starts a run of the team
 * agent with the message as its goal; the chat shows those runs (goal, reply, member calls).
 */
export function CoordinatorChat({ teamAgentId, exchanges, onSend }: CoordinatorChatProps) {
  const [draftMessage, setDraftMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedMessage = draftMessage.trim()
    if (!trimmedMessage) return
    setDraftMessage('')
    setSendError(null)
    setIsSending(true)
    try {
      await onSend(trimmedMessage)
    } catch (rawError) {
      setDraftMessage(trimmedMessage)
      setSendError(rawError instanceof Error ? rawError.message : messages().team.couldNotSendTheMessage)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section aria-label={messages().team.talkToTheCoordinator} className="box-border flex min-w-0 flex-[1_1_340px] flex-col border-r border-line">
      <header className="box-border flex h-16 items-center gap-2.5 border-b border-line px-5">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-inverse">
          {messages().team.co}
        </span>
        <span className="flex flex-col">
          <span className="font-semibold">{messages().team.coordinator}</span>
          <span className="text-[12px] text-muted">{messages().team.plansAndHandsOutWork}</span>
        </span>
      </header>
      <div aria-live="polite" className="flex flex-auto flex-col gap-4 p-5">
        {exchanges?.length === 0 && <p className="m-0 text-[13px] text-muted">{messages().team.giveTheTeamAGoalEach}</p>}
        {exchanges?.map((exchange) => (
          <div key={exchange.runId} className="flex flex-col gap-4">
            {exchange.message && <UserBubble text={exchange.message} />}
            <CoordinatorReply exchange={exchange} teamAgentId={teamAgentId} />
          </div>
        ))}
        {sendError && (
          <p role="alert" className="m-0 text-[13px] text-amber-strong">
            {sendError}
          </p>
        )}
      </div>
      <form onSubmit={(event) => void sendMessage(event)} className="px-5 pt-3 pb-5">
        <label htmlFor="coordinator-message">
          <VisuallyHidden>{messages().team.messageTheCoordinator}</VisuallyHidden>
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-line-strong py-1.5 pr-1.5 pl-3.5">
          <input
            id="coordinator-message"
            type="text"
            placeholder={messages().team.giveTheTeamAGoal}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            className="h-9 min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
          />
          <button
            type="submit"
            aria-label={messages().team.send}
            disabled={isSending}
            className="flex size-9 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-ink text-inverse hover:bg-ink-2 disabled:opacity-60"
          >
            <StrokeIcon size={16}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </StrokeIcon>
          </button>
        </div>
      </form>
    </section>
  )
}
