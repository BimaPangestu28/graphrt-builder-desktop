import { useState, type FormEvent } from 'react'
import { dailySendLimit } from '@/data/batchApproval'

interface SendPlanPanelProps {
  selectedCount: number
  autoSendHighScores: boolean
  onAutoSendHighScoresChange: (isEnabled: boolean) => void
}

function PlanRow({ label, value, hasDivider }: { label: string; value: string; hasDivider: boolean }) {
  return (
    <div className={`flex justify-between gap-2 py-2.5 ${hasDivider ? 'border-b border-chip' : ''}`}>
      <span className="text-body">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

/**
 * Right-hand panel of the batch review: how the approved messages will be paced,
 * a one-line instruction to rewrite every selected message, and the auto-send preference.
 */
export function SendPlanPanel({ selectedCount, autoSendHighScores, onAutoSendHighScoresChange }: SendPlanPanelProps) {
  const [rewriteInstruction, setRewriteInstruction] = useState('')
  const [rewriteStatus, setRewriteStatus] = useState('')

  function submitRewriteInstruction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedInstruction = rewriteInstruction.trim()
    if (!trimmedInstruction) return
    setRewriteStatus(`Rewriting ${selectedCount} selected messages: “${trimmedInstruction}”`)
    setRewriteInstruction('')
  }

  return (
    <aside className="box-border flex min-w-0 flex-[1_1_300px] flex-col gap-5 border-l border-line bg-subtle p-6">
      <section aria-labelledby="plan-h" className="flex flex-col gap-2.5">
        <h2 id="plan-h" className="m-0 text-[15px] font-semibold">
          How it sends
        </h2>
        <div className="rounded-xl border border-line bg-surface px-3.5 py-1">
          <PlanRow label="Gap" value="30s between messages" hasDivider />
          <PlanRow label="Finishes around" value="09:47" hasDivider />
          <PlanRow label="Daily limit left" value={`${Math.max(dailySendLimit - selectedCount, 0)} of ${dailySendLimit}`} hasDivider={false} />
        </div>
      </section>
      <section aria-labelledby="fix-h" className="flex flex-col gap-2.5">
        <h2 id="fix-h" className="m-0 text-[15px] font-semibold">
          Change all messages
        </h2>
        <form onSubmit={submitRewriteInstruction}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body">Tell the agent what to change, it rewrites the selected ones</span>
            <input
              type="text"
              value={rewriteInstruction}
              onChange={(event) => setRewriteInstruction(event.target.value)}
              placeholder="e.g. mention free delivery above 30 boxes"
              className="box-border h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink"
            />
          </label>
        </form>
        {rewriteStatus && (
          <p role="status" className="m-0 text-[13px] text-brand-strong">
            {rewriteStatus}
          </p>
        )}
      </section>
      <label className="flex cursor-pointer items-start gap-2.5 leading-normal">
        <input
          type="checkbox"
          checked={autoSendHighScores}
          onChange={(event) => onAutoSendHighScoresChange(event.target.checked)}
          className="mt-[3px] size-[18px] shrink-0 cursor-pointer accent-ink"
        />
        Next time, send messages with score 8 and up without asking
      </label>
      <p className="m-0 text-[13px] leading-normal text-body">You can close the app. Sending continues from the menu bar and replies land in Inbox</p>
    </aside>
  )
}
