import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { batchMessages as initialBatchMessages, batchRunSummary, initiallyVisibleCount, lowScoreThreshold, type BatchMessage } from '@/data/batchApproval'
import { routePaths } from '@/routes'
import { BatchMessageRow } from './batch-approval/BatchMessageRow'
import { SendPlanPanel } from './batch-approval/SendPlanPanel'

const secondaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-subtle'
const primaryButtonClassNames =
  'h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50'

/** Low-scoring leads start unselected so the user opts in to them explicitly. */
function selectDefaultMessageIds(messages: BatchMessage[]): Set<string> {
  return new Set(messages.filter((batchMessage) => batchMessage.score >= lowScoreThreshold).map((batchMessage) => batchMessage.id))
}

/**
 * Screen 19 · Review a scheduled run.
 * A scheduled run of "Maps leads to WhatsApp" wrote 12 messages and waits for approval.
 * The user can tick/untick each message (or all at once), edit any message inline,
 * reveal the rest of the batch, then send the selection or skip the whole run.
 */
export function BatchApprovalPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<BatchMessage[]>(initialBatchMessages)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => selectDefaultMessageIds(initialBatchMessages))
  const [editingMessageId, setEditingMessageId] = useState<string | null>(initialBatchMessages[0]?.id ?? null)
  const [isShowingAll, setIsShowingAll] = useState(false)
  const [autoSendHighScores, setAutoSendHighScores] = useState(false)

  const selectedCount = selectedMessageIds.size
  const visibleMessages = isShowingAll ? messages : messages.slice(0, initiallyVisibleCount)
  const hiddenCount = messages.length - visibleMessages.length

  function toggleMessageSelected(messageId: string) {
    setSelectedMessageIds((previousIds) => {
      const nextIds = new Set(previousIds)
      if (nextIds.has(messageId)) nextIds.delete(messageId)
      else nextIds.add(messageId)
      return nextIds
    })
  }

  function toggleAllSelected() {
    const isEverythingSelected = selectedCount === messages.length
    setSelectedMessageIds(isEverythingSelected ? new Set() : new Set(messages.map((batchMessage) => batchMessage.id)))
  }

  function changeMessageText(messageId: string, message: string) {
    setMessages((previousMessages) => previousMessages.map((batchMessage) => (batchMessage.id === messageId ? { ...batchMessage, message } : batchMessage)))
  }

  return (
    <AppShell mainClassName="flex flex-col">
      <header className="box-border flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.3px]">Review {messages.length} messages</h1>
          <span className="text-body">{batchRunSummary}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClassNames} onClick={() => navigate(routePaths.runs)}>
            Skip this run
          </button>
          <button type="button" className={primaryButtonClassNames} disabled={selectedCount === 0} onClick={() => navigate(routePaths.runs)}>
            Send {selectedCount} selected
          </button>
        </div>
      </header>

      <div className="flex flex-auto flex-wrap">
        <section aria-label="Messages" className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-3 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <label className="flex cursor-pointer items-center gap-2.5 font-medium">
              <input type="checkbox" checked={selectedCount > 0} onChange={toggleAllSelected} className="size-[18px] cursor-pointer accent-ink" />
              {selectedCount} of {messages.length} selected
            </label>
            <span className="text-[13px] text-muted">Unselected ones are skipped and can be sent next run</span>
          </div>
          <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-line p-0">
            {visibleMessages.map((batchMessage, index) => (
              <BatchMessageRow
                key={batchMessage.id}
                batchMessage={batchMessage}
                position={index + 1}
                isSelected={selectedMessageIds.has(batchMessage.id)}
                isEditing={editingMessageId === batchMessage.id}
                isLast={hiddenCount === 0 && index === visibleMessages.length - 1}
                onToggleSelected={toggleMessageSelected}
                onStartEditing={setEditingMessageId}
                onChangeMessage={changeMessageText}
              />
            ))}
            {hiddenCount > 0 && (
              <li className="flex gap-3.5 px-4 py-3.5 text-muted">
                <span className="w-[18px]" />
                <button
                  type="button"
                  onClick={() => setIsShowingAll(true)}
                  className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
                >
                  Show {hiddenCount} more
                </button>
              </li>
            )}
          </ul>
        </section>

        <SendPlanPanel selectedCount={selectedCount} autoSendHighScores={autoSendHighScores} onAutoSendHighScoresChange={setAutoSendHighScores} />
      </div>
    </AppShell>
  )
}
