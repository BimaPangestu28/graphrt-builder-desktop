import type { Conversation } from '@/api/conversationTypes'
import { joinClassNames } from '@/components/ui'
import { formatClockTime, getChannelLabel, humanizeVariableName, isOwnerReplying } from './conversationDisplay'

interface CustomerPanelProps {
  conversation: Conversation
  isOrderSaved: boolean
  onSaveOrder: () => void
  onTakeOver: () => void
  onHandBack: () => void
  onClose: () => void
  /** True while a take over / hand back / close request is running. */
  isBusy: boolean
}

interface MemoryRow {
  label: string
  value: string
  isMissing: boolean
}

const panelButtonClassNames = 'h-10 cursor-pointer rounded-[10px] text-[14px] font-medium disabled:cursor-default disabled:opacity-60'
const secondaryButtonClassNames = joinClassNames(panelButtonClassNames, 'border border-line-strong bg-surface text-ink hover:bg-subtle')

/** The bot's `conversation.*` memory as rows; empty values read "Missing", objects are skipped. */
function toMemoryRows(variables: Record<string, unknown>): MemoryRow[] {
  return Object.entries(variables)
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .map(([name, value]) => {
      const text = value === null ? '' : String(value).trim()
      return { label: humanizeVariableName(name), value: text || 'Missing', isMissing: text === '' }
    })
}

function describeOrigin(conversation: Conversation): string {
  const startedAt = formatClockTime(conversation.createdAt)
  if (conversation.channel === 'test') return `Try it test chat, ${startedAt}`
  if (conversation.origin === 'outreach') return `Outreach agent on ${getChannelLabel(conversation.channel)}, ${startedAt}`
  return `Messaged first on ${getChannelLabel(conversation.channel)}, ${startedAt}`
}

function MemoryList({ rows }: { rows: MemoryRow[] }) {
  return (
    <dl className="m-0 rounded-xl border border-line px-3.5 py-1">
      {rows.map((row, index) => (
        <div key={row.label} className={joinClassNames('flex justify-between gap-2 py-2.5', index < rows.length - 1 && 'border-b border-chip')}>
          <dt className="text-body">{row.label}</dt>
          <dd className={joinClassNames('m-0 text-right font-medium', row.isMissing && 'text-amber-strong')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Right column of the chat detail: the bot's summary, what it remembered (its `conversation.*`
 * variables), where the chat came from, plus "Save order to sheet", take over / hand back and close.
 */
export function CustomerPanel({ conversation, isOrderSaved, onSaveOrder, onTakeOver, onHandBack, onClose, isBusy }: CustomerPanelProps) {
  const memoryRows = toMemoryRows(conversation.variables)
  const isClosed = conversation.status === 'closed'
  return (
    <aside aria-label="Customer" className="box-border flex min-w-0 flex-[1_1_280px] flex-col gap-5 border-l border-line p-5">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-muted">Summary by bot</span>
        <p className="m-0 leading-[1.55]">{conversation.summary ?? 'No summary yet. The bot writes one once the chat has enough detail'}</p>
      </div>
      {memoryRows.length > 0 && <MemoryList rows={memoryRows} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">Came from</span>
        <span className="leading-normal">{describeOrigin(conversation)}</span>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <button type="button" onClick={onSaveOrder} disabled={isOrderSaved} className={joinClassNames(panelButtonClassNames, 'border-0 bg-ink text-white hover:bg-ink-2 disabled:bg-ok disabled:opacity-100')}>
          {isOrderSaved ? 'Saved to sheet' : 'Save order to sheet'}
        </button>
        {!isClosed && (
          <button type="button" disabled={isBusy} onClick={isOwnerReplying(conversation) ? onHandBack : onTakeOver} className={secondaryButtonClassNames}>
            {isOwnerReplying(conversation) ? 'Hand back to bot' : 'Take over from bot'}
          </button>
        )}
        <button type="button" disabled={isBusy || isClosed} onClick={onClose} className={secondaryButtonClassNames}>
          {isClosed ? 'Chat closed' : 'Close chat'}
        </button>
      </div>
    </aside>
  )
}
