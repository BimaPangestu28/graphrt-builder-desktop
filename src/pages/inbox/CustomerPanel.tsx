import { joinClassNames } from '@/components/ui'
import type { CustomerSummary } from '@/data/inbox'

interface CustomerPanelProps {
  summary?: CustomerSummary
  isHumanReplying: boolean
  onToggleTakeOver: () => void
  isOrderSaved: boolean
  onSaveOrder: () => void
}

const panelButtonClassNames = 'h-10 cursor-pointer rounded-[10px] text-[14px] font-medium disabled:cursor-default'

/**
 * Right column of the chat detail: the bot's summary, the order it collected, where the lead
 * came from, plus "Save order to sheet" and the take-over toggle button.
 */
export function CustomerPanel({ summary, isHumanReplying, onToggleTakeOver, isOrderSaved, onSaveOrder }: CustomerPanelProps) {
  return (
    <aside aria-label="Customer" className="box-border flex min-w-0 flex-[1_1_280px] flex-col gap-5 border-l border-line p-5">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-muted">Summary by bot</span>
        <p className="m-0 leading-[1.55]">{summary?.botSummary ?? 'No summary yet. The bot writes one once the chat has enough detail'}</p>
      </div>
      {summary && (
        <>
          <dl className="m-0 rounded-xl border border-line px-3.5 py-1">
            {summary.orderRows.map((row, index) => (
              <div key={row.label} className={joinClassNames('flex justify-between gap-2 py-2.5', index < summary.orderRows.length - 1 && 'border-b border-chip')}>
                <dt className="text-body">{row.label}</dt>
                <dd className={joinClassNames('m-0 font-medium', row.isMissing && 'text-amber-strong')}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Came from</span>
            <span className="leading-normal">{summary.cameFrom}</span>
          </div>
        </>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <button type="button" onClick={onSaveOrder} disabled={isOrderSaved} className={joinClassNames(panelButtonClassNames, 'border-0 bg-ink text-white hover:bg-ink-2 disabled:bg-ok')}>
          {isOrderSaved ? 'Saved to sheet' : 'Save order to sheet'}
        </button>
        <button type="button" onClick={onToggleTakeOver} className={joinClassNames(panelButtonClassNames, 'border border-line-strong bg-surface text-ink hover:bg-subtle')}>
          {isHumanReplying ? 'Hand back to bot' : 'Take over from bot'}
        </button>
      </div>
    </aside>
  )
}
