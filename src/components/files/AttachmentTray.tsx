import { Icon } from '@/components/ui'
import { messages } from '@/i18n'
import { fileKindIcon, formatFileSize } from './fileDisplay'
import type { ChatAttachments } from './useChatAttachments'

/** What the agent takes, in one line, shown while files are being added. */
function takesHint(attachments: ChatAttachments): string {
  const { readsFiles, seesPictures } = attachments.abilities
  if (readsFiles && seesPictures) return messages().files.takesFilesAndPictures
  return readsFiles ? messages().files.takesFilesOnly : messages().files.takesPicturesOnly
}

/**
 * The files waiting to be sent, above a chat composer: one chip per file (name on one line, size,
 * a remove button), then the notices for files that were refused. Renders nothing when there is
 * nothing to say.
 *
 * @param attachments - The composer's attachments (ChatAttachments, from `useChatAttachments`)
 *
 * @example
 * <AttachmentTray attachments={attachments} />
 */
export function AttachmentTray({ attachments }: { attachments: ChatAttachments }) {
  const { pending, notices, isAttaching, remove } = attachments
  if (pending.length === 0 && notices.length === 0 && !isAttaching) return null
  return (
    <div className="ui-block flex min-w-0 flex-col gap-1.5">
      {pending.length > 0 && (
        <ul aria-label={messages().files.attached} className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
          {pending.map((card) => (
            <li
              key={card.reference}
              className="flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface pr-1 pl-2 text-[12px] text-ink"
            >
              <Icon name={fileKindIcon(card.kind)} size={14} className="flex-none text-muted" />
              <span title={card.name} className="max-w-[11rem] truncate font-medium">
                {card.name}
              </span>
              <span className="flex-none whitespace-nowrap text-muted">{formatFileSize(card.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => remove(card)}
                aria-label={messages().files.remove(card.name)}
                className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-chip hover:text-ink"
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAttaching && (
        <span role="status" className="truncate text-[12px] text-muted">
          {messages().files.attaching} {takesHint(attachments)}
        </span>
      )}
      {notices.map((notice) => (
        <p key={notice} role="alert" className="m-0 text-[12px] leading-[1.4] text-amber-strong">
          {notice}
        </p>
      ))}
    </div>
  )
}
