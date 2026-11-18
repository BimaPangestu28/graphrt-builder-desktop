import { useId } from 'react'

interface ApprovalCardProps {
  recipientSummary: string
  message: string
  onMessageChange: (message: string) => void
  onApprove: () => void
  onSkip: () => void
  /** True while the answer is being sent; both buttons are disabled. */
  isSubmitting?: boolean
}

/**
 * The amber "Send this message?" card shown when a run pauses on an approval step.
 * The message is editable before approving; an empty message cannot be sent.
 */
export function ApprovalCard({ recipientSummary, message, onMessageChange, onApprove, onSkip, isSubmitting = false }: ApprovalCardProps) {
  const titleId = useId()
  const messageId = useId()
  const isMessageEmpty = message.trim().length === 0

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3.5 rounded-2xl border-2 border-amber-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="m-0 text-[18px] font-semibold">
          Send this message?
        </h2>
        <span className="text-[13px] text-body">{recipientSummary}</span>
      </div>
      <label htmlFor={messageId} className="text-[12px] font-medium text-ink-2">
        Message, edit before sending if needed
      </label>
      <textarea
        id={messageId}
        rows={3}
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        className="resize-y rounded-xl border border-line-strong bg-[#F7FCF9] px-3.5 py-3 text-[14px] leading-[1.55] text-ink outline-brand"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={isMessageEmpty || isSubmitting}
          className="h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve and send
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isSubmitting}
          className="h-10 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip this place
        </button>
        <span className="ml-auto text-[12px] text-muted">Paused safely. You can close the app and come back</span>
      </div>
    </section>
  )
}
