import { useEffect, useRef, useState } from 'react'
import { saveAgentFile } from '@/api/agentFiles'
import type { FileCard } from '@/api/agentFileTypes'
import { Icon, joinClassNames } from '@/components/ui'
import { toErrorMessage } from '@/lib/errors'
import { messages } from '@/i18n'
import { fileKindIcon, fileMetaLine } from './fileDisplay'
import { useFilePreview } from './useFilePreview'

/** How long a card says "Saved" after a download, in milliseconds. */
const savedNoticeMs = 2500

type SaveState = 'idle' | 'saving' | 'saved'

interface FileCardItemProps {
  agentId: string
  card: FileCard
  onSaveError: (message: string | null) => void
}

/**
 * One file as a card: a small picture (raster pictures only) or an icon, the name on one line,
 * its kind and size, and a Download button that opens the system save dialog.
 */
function FileCardItem({ agentId, card, onSaveError }: FileCardItemProps) {
  const pictureUrl = useFilePreview(agentId, card)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const savedTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
    },
    [],
  )

  async function download() {
    onSaveError(null)
    setSaveState('saving')
    try {
      const outcome = await saveAgentFile(agentId, card.reference, messages().files.saveDialogTitle(card.name))
      setSaveState(outcome.saved ? 'saved' : 'idle')
      if (outcome.saved) savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), savedNoticeMs)
    } catch (rawError) {
      setSaveState('idle')
      onSaveError(messages().files.couldNotSave(card.name, toErrorMessage(rawError)))
    }
  }

  const buttonLabel = saveState === 'saving' ? messages().files.saving : saveState === 'saved' ? messages().files.saved : messages().files.download
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface text-left text-ink">
      <div className="flex h-20 flex-none items-center justify-center overflow-hidden bg-subtle text-muted">
        {pictureUrl ? (
          <img src={pictureUrl} alt={messages().files.previewOf(card.name)} className="size-full object-cover" draggable={false} />
        ) : (
          <Icon name={fileKindIcon(card.kind)} size={26} strokeWidth={1.6} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 pt-2">
        <span title={card.name} className="truncate text-[13px] leading-[1.3] font-medium">
          {card.name}
        </span>
        <span className="truncate text-[12px] leading-[1.3] text-muted">{fileMetaLine(card)}</span>
      </div>
      <div className="p-2.5 pt-2">
        <button
          type="button"
          onClick={() => void download()}
          disabled={saveState === 'saving'}
          aria-label={messages().files.downloadNamed(card.name)}
          className={joinClassNames(
            'flex h-8 w-full min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 text-[13px] font-medium whitespace-nowrap text-ink',
            'hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-60',
          )}
        >
          <Icon name={saveState === 'saved' ? 'check' : 'download'} size={14} className="flex-none" />
          <span className="truncate">{buttonLabel}</span>
        </button>
      </div>
    </li>
  )
}

interface FileCardGridProps {
  /** The agent the files belong to; a file's `reference` only resolves inside its agent's files. */
  agentId: string
  cards: FileCard[]
  /** What the group is, for screen readers ("Attached files", "Files the agent made"). */
  label: string
  className?: string
}

/**
 * Files as cards in two columns, three when there is room (the grid follows its own width, not
 * the window's). Names and labels stay on one line and are cut with an ellipsis; the full name
 * is the tooltip. Uses the colour tokens only, inside the `ui-block` theme scope UI blocks use,
 * so the cards follow the same light and dark colours.
 *
 * @param agentId - The agent the files belong to (string)
 * @param cards - The files to show; nothing is rendered for none (FileCard[])
 * @param label - Accessible name of the group (string)
 *
 * @example
 * <FileCardGrid agentId={conversation.agentId} cards={files} label={messages().files.madeByTheAgent} />
 */
export function FileCardGrid({ agentId, cards, label, className }: FileCardGridProps) {
  const [saveError, setSaveError] = useState<string | null>(null)
  if (cards.length === 0) return null
  return (
    <section aria-label={label} className={joinClassNames('ui-block @container flex w-full min-w-0 flex-col gap-1.5', className)}>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 @md:grid-cols-3">
        {cards.map((card) => (
          <FileCardItem key={card.reference} agentId={agentId} card={card} onSaveError={setSaveError} />
        ))}
      </ul>
      {saveError && (
        <p role="alert" title={saveError} className="m-0 truncate text-[12px] text-amber-strong">
          {saveError}
        </p>
      )}
    </section>
  )
}
