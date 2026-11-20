import { useState } from 'react'
import { getBotEnabled, setBotEnabled } from '@/api/conversations'
import { outreachOrigin, type ConversationCounts, type ConversationFilter } from '@/api/conversationTypes'
import type { Agent } from '@/api/types'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { StatusDot, joinClassNames } from '@/components/ui'
import { useAgents } from '@/hooks/useAgents'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useConversationCounts, useConversationList } from '@/hooks/useConversations'
import { ConversationTable } from './inbox/ConversationTable'

type InboxFilterKey = 'all' | 'waiting' | 'bot-answering' | 'from-outreach' | 'closed'

interface InboxFilter {
  key: InboxFilterKey
  label: string
  /** Backend filter for the chip. */
  filter: ConversationFilter
  /** Count shown after the label. Closed has no count in the design. */
  readCount?: (counts: ConversationCounts) => number
}

const inboxFilters: InboxFilter[] = [
  { key: 'all', label: 'All', filter: {}, readCount: (counts) => counts.all },
  { key: 'waiting', label: 'Waiting for you', filter: { status: 'waiting_for_you' }, readCount: (counts) => counts.waitingForYou },
  { key: 'bot-answering', label: 'Bot answering', filter: { status: 'bot_answering' }, readCount: (counts) => counts.botAnswering },
  { key: 'from-outreach', label: 'From outreach', filter: { origin: outreachOrigin }, readCount: (counts) => counts.fromOutreach },
  { key: 'closed', label: 'Closed', filter: { status: 'closed' } },
]

function BotAnsweringToggle({ chatbot }: { chatbot: Agent }) {
  const { data: isBotEnabled, reload } = useAsyncData(() => getBotEnabled(chatbot.id), [chatbot.id])
  const [isSaving, setIsSaving] = useState(false)
  const isBotAnswering = isBotEnabled ?? true

  async function changeBotEnabled(enabled: boolean) {
    setIsSaving(true)
    try {
      await setBotEnabled(chatbot.id, enabled)
      await reload()
    } catch (saveError) {
      console.error('Could not change the bot switch', saveError)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <label className="box-border flex h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong px-3.5">
      <StatusDot tone={isBotAnswering ? 'ok' : 'paused'} />
      {isBotAnswering ? 'Bot is answering' : 'Bot is paused'}
      <input
        type="checkbox"
        checked={isBotAnswering}
        disabled={isSaving || isBotEnabled === null}
        onChange={(event) => void changeBotEnabled(event.target.checked)}
        className="size-[18px] accent-brand"
      />
    </label>
  )
}

function InboxStatTile({ label, value, isHighlighted = false }: { label: string; value: number | undefined; isHighlighted?: boolean }) {
  return (
    <div className={joinClassNames('flex flex-col gap-1 rounded-xl border p-3.5', isHighlighted ? 'border-amber-line bg-amber-tint' : 'border-line')}>
      <span className={joinClassNames('text-[12px]', isHighlighted ? 'text-amber-strong' : 'text-muted')}>{label}</span>
      <span className="text-[24px] font-semibold">{value ?? '–'}</span>
    </div>
  )
}

function InboxFilterChips({ activeFilterKey, counts, onSelect }: { activeFilterKey: InboxFilterKey; counts: ConversationCounts | null; onSelect: (filterKey: InboxFilterKey) => void }) {
  return (
    <div role="group" aria-label="Filter chats" className="flex flex-wrap items-center gap-2">
      {inboxFilters.map((inboxFilter) => {
        const isActive = inboxFilter.key === activeFilterKey
        const count = counts && inboxFilter.readCount ? inboxFilter.readCount(counts) : undefined
        return (
          <button
            key={inboxFilter.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(inboxFilter.key)}
            className={joinClassNames(
              'h-[34px] cursor-pointer rounded-full px-3 text-[13px] font-medium',
              isActive ? 'border-0 bg-ink text-white' : 'border border-line-strong bg-surface text-ink hover:bg-subtle',
            )}
          >
            {count === undefined ? inboxFilter.label : `${inboxFilter.label} ${count}`}
          </button>
        )
      })}
    </div>
  )
}

function InboxConversations({ filter }: { filter: ConversationFilter }) {
  const { data: conversations, error } = useConversationList(filter)
  if (error) return <p className="m-0 text-muted">Could not load chats. {error.message}</p>
  if (!conversations) return <p className="m-0 text-muted">Loading chats…</p>
  return <ConversationTable conversations={conversations} />
}

/**
 * Screen 15 · Inbox.
 * Every chat the chatbots are handling: counts, filter chips and a table of conversations, all kept
 * live through `conversation-event`s. Chats waiting for a person are tinted amber. Clicking a row
 * opens the chat detail (16). The "Bot is answering" switch pauses or resumes the first chatbot.
 */
export function InboxPage() {
  const [activeFilterKey, setActiveFilterKey] = useState<InboxFilterKey>('all')
  const activeFilter = inboxFilters.find((inboxFilter) => inboxFilter.key === activeFilterKey) ?? inboxFilters[0]
  const { data: counts } = useConversationCounts()
  const { data: agents } = useAgents()
  const chatbot = agents?.find((agent) => agent.kind === 'chatbot')

  return (
    <AppShell activeNav="inbox" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock
          title="Inbox"
          subtitle={chatbot ? `${chatbot.name} · answering your customers` : 'Chats your chatbots hand to you show up here'}
          actions={chatbot ? <BotAnsweringToggle chatbot={chatbot} /> : undefined}
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
          <InboxStatTile label="All chats" value={counts?.all} />
          <InboxStatTile label="Bot answering" value={counts?.botAnswering} />
          <InboxStatTile label="Waiting for you" value={counts?.waitingForYou} isHighlighted />
          <InboxStatTile label="From outreach" value={counts?.fromOutreach} />
        </div>

        <InboxFilterChips activeFilterKey={activeFilterKey} counts={counts} onSelect={setActiveFilterKey} />
        <InboxConversations filter={activeFilter.filter} />
      </PageFrame>
    </AppShell>
  )
}
