import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { StatusDot, joinClassNames } from '@/components/ui'
import { inboxConversations, inboxStats, isWaitingForYou, type InboxConversation } from '@/data/inbox'
import { ConversationTable } from './inbox/ConversationTable'

type InboxFilterKey = 'all' | 'waiting' | 'bot-answering' | 'from-outreach' | 'closed'

interface InboxFilter {
  key: InboxFilterKey
  label: string
  /** Today's total, shown after the label. Closed has no count in the design. */
  count?: number
  matches: (conversation: InboxConversation) => boolean
}

const inboxFilters: InboxFilter[] = [
  { key: 'all', label: 'All', count: inboxStats.chatsToday, matches: () => true },
  { key: 'waiting', label: 'Waiting for you', count: inboxStats.waitingForYou, matches: isWaitingForYou },
  { key: 'bot-answering', label: 'Bot answering', count: inboxStats.botAnswering, matches: (conversation) => conversation.status === 'bot-answering' },
  { key: 'from-outreach', label: 'From outreach', count: inboxStats.fromOutreach, matches: (conversation) => conversation.isFromOutreach },
  { key: 'closed', label: 'Closed', matches: (conversation) => conversation.status === 'closed' },
]

function BotAnsweringToggle({ isBotAnswering, onChange }: { isBotAnswering: boolean; onChange: (isOn: boolean) => void }) {
  return (
    <label className="box-border flex h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong px-3.5">
      <StatusDot tone={isBotAnswering ? 'ok' : 'paused'} />
      {isBotAnswering ? 'Bot is answering' : 'Bot is paused'}
      <input type="checkbox" checked={isBotAnswering} onChange={(event) => onChange(event.target.checked)} className="size-[18px] accent-brand" />
    </label>
  )
}

function InboxStatTile({ label, value, isHighlighted = false }: { label: string; value: number; isHighlighted?: boolean }) {
  return (
    <div className={joinClassNames('flex flex-col gap-1 rounded-xl border p-3.5', isHighlighted ? 'border-amber-line bg-amber-tint' : 'border-line')}>
      <span className={joinClassNames('text-[12px]', isHighlighted ? 'text-amber-strong' : 'text-muted')}>{label}</span>
      <span className="text-[24px] font-semibold">{value}</span>
    </div>
  )
}

function InboxFilterChips({ activeFilterKey, onSelect }: { activeFilterKey: InboxFilterKey; onSelect: (filterKey: InboxFilterKey) => void }) {
  return (
    <div role="group" aria-label="Filter chats" className="flex flex-wrap items-center gap-2">
      {inboxFilters.map((filter) => {
        const isActive = filter.key === activeFilterKey
        return (
          <button
            key={filter.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(filter.key)}
            className={joinClassNames(
              'h-[34px] cursor-pointer rounded-full px-3 text-[13px] font-medium',
              isActive ? 'border-0 bg-ink text-white' : 'border border-line-strong bg-surface text-ink hover:bg-subtle',
            )}
          >
            {filter.count === undefined ? filter.label : `${filter.label} ${filter.count}`}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Screen 15 · Inbox.
 * Every chat the Catering assistant chatbot is handling on WhatsApp: today's stats, filter chips
 * and a table of conversations. Chats waiting for a person are tinted amber. Clicking a row opens
 * the chat detail (16). The "Bot is answering" switch pauses or resumes the bot locally.
 */
export function InboxPage() {
  const [isBotAnswering, setIsBotAnswering] = useState(true)
  const [activeFilterKey, setActiveFilterKey] = useState<InboxFilterKey>('all')
  const activeFilter = inboxFilters.find((filter) => filter.key === activeFilterKey) ?? inboxFilters[0]
  const visibleConversations = inboxConversations.filter(activeFilter.matches)

  return (
    <AppShell activeNav="inbox" agents={{ kind: 'list' }} mainClassName="box-border flex flex-col gap-6 px-8 py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.5px]">Inbox</h1>
          <span className="text-body">Catering assistant · answering on WhatsApp</span>
        </div>
        <BotAnsweringToggle isBotAnswering={isBotAnswering} onChange={setIsBotAnswering} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
        <InboxStatTile label="Chats today" value={inboxStats.chatsToday} />
        <InboxStatTile label="Answered by bot" value={inboxStats.answeredByBot} />
        <InboxStatTile label="Waiting for you" value={inboxStats.waitingForYou} isHighlighted />
        <InboxStatTile label="Orders collected" value={inboxStats.ordersCollected} />
      </div>

      <InboxFilterChips activeFilterKey={activeFilterKey} onSelect={setActiveFilterKey} />
      <ConversationTable conversations={visibleConversations} />
    </AppShell>
  )
}
