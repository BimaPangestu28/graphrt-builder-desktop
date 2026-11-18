import type { FormEvent, KeyboardEvent } from 'react'

interface ReplyComposerProps {
  draft: string
  onDraftChange: (draft: string) => void
  onSend: () => void
  /** False while the bot answers: the composer is disabled until you take over. */
  isHumanReplying: boolean
  suggestedReply?: string
}

/**
 * Composer under the chat detail thread: an optional suggested reply chip, a textarea and Send.
 * Enter sends, Shift+Enter adds a new line.
 */
export function ReplyComposer({ draft, onDraftChange, onSend, isHumanReplying, suggestedReply }: ReplyComposerProps) {
  const canSend = isHumanReplying && draft.trim() !== ''

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSend) onSend()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canSend) onSend()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 border-t border-line px-5 pt-3 pb-4">
      {isHumanReplying && suggestedReply && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">Suggested</span>
          <button
            type="button"
            lang="id"
            onClick={() => onDraftChange(suggestedReply)}
            className="min-h-[30px] cursor-pointer rounded-lg border border-brand-line-2 bg-brand-tint px-2.5 text-left text-[13px] text-brand-strong hover:bg-brand-soft"
          >
            {suggestedReply}
          </button>
        </div>
      )}
      <label htmlFor="reply" className="sr-only">
        Your reply
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="reply"
          rows={2}
          value={draft}
          disabled={!isHumanReplying}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isHumanReplying ? 'Reply as yourself' : 'The bot is answering. Take over to reply yourself'}
          className="min-w-0 flex-1 resize-none rounded-xl border border-line-strong px-3 py-2.5 text-[14px] leading-normal text-ink outline-none focus:border-brand disabled:bg-subtle"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="h-11 cursor-pointer rounded-[10px] border-0 bg-ink px-4 text-[14px] font-medium text-white hover:bg-ink-2 disabled:cursor-default disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  )
}
