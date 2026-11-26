import { useId, type ClipboardEventHandler, type ReactNode } from 'react'
import { Button, Icon, joinClassNames } from '@/components/ui'
import type { DroppedItem, FileDropAccept } from '@/lib/fileDrop'
import { useFileDropZone, type FileDragState } from './useFileDropZone'
import { messages, useT } from '@/i18n'

export interface FileDropZoneProps {
  /** What to drop, completing "Drag … here": "your plugin folder or .tar.gz archive". */
  itemDescription: string
  /** What the zone takes; anything else is refused with a message. */
  accept: FileDropAccept
  /** Several items at once (default false: one, and dropping more is refused). */
  multiple?: boolean
  /** Called with the accepted dropped items (absolute paths in the desktop app, names in the preview). */
  onDrop: (items: DroppedItem[]) => void
  /** Text of the button that opens the existing picker, e.g. "Choose files…". */
  chooseLabel: string
  onChoose: () => void
  /** More picker buttons shown after Choose (e.g. "Choose .tar.gz…"). */
  secondaryActions?: ReactNode
  /** Accepted types and size, e.g. "PDF, Word, Excel · up to 50 MB". */
  hint?: string
  disabled?: boolean
  /** Smaller padding for zones inside forms. */
  compact?: boolean
  /** Lets the zone take pasted text (the Knowledge page takes links). */
  onPaste?: ClipboardEventHandler<HTMLDivElement>
  className?: string
  /** Shown under the hint, e.g. the files chosen so far. */
  children?: ReactNode
}

const zoneStateClassNames: Record<FileDragState, string> = {
  idle: 'border-line-heavy bg-subtle',
  accepting: 'border-brand bg-brand-tint ring-2 ring-brand-line',
  refusing: 'border-danger-line bg-danger-tint',
}

function headline(dragState: FileDragState, itemDescription: string): string {
  const t = messages().shell.fileDrop
  if (dragState === 'accepting') return t.dropToAdd
  if (dragState === 'refusing') return t.cannotBeAdded
  return t.dragHereOr(itemDescription)
}

/**
 * A dashed area that takes dragged files or folders and has a Choose button for the picker.
 *
 * Only the zone under the pointer reacts to a drag (see `fileDropRouter`). In the desktop app
 * drops give real filesystem paths; in the browser preview they give names. What does not fit
 * `accept` / `multiple` is refused with a message in a polite live region, which also announces
 * "Drop to add" while a drag is over the zone. The Choose button keeps the zone usable from the
 * keyboard.
 *
 * @example
 * <FileDropZone
 *   itemDescription="your plugin folder or .tar.gz archive"
 *   accept={{ extensions: ['tar.gz', 'tgz'], folders: true }}
 *   onDrop={([item]) => install(item.path)}
 *   chooseLabel="Choose folder…"
 *   onChoose={() => pick('folder')}
 * />
 */
export function FileDropZone({
  itemDescription,
  accept,
  multiple = false,
  onDrop,
  chooseLabel,
  onChoose,
  secondaryActions,
  hint,
  disabled = false,
  compact = false,
  onPaste,
  className,
  children,
}: FileDropZoneProps) {
  const hintId = useId()
  const { zoneRef, dragState, rejection, clearRejection, browserDropHandlers } = useFileDropZone({ accept, multiple, onDrop, disabled })
  const t = useT().shell.fileDrop
  const statusText = rejection ?? (dragState === 'accepting' ? t.dropToAdd : '')

  return (
    <div
      ref={zoneRef}
      role="group"
      aria-label={t.dropLabel(itemDescription)}
      aria-describedby={hint ? hintId : undefined}
      aria-disabled={disabled || undefined}
      data-drag-state={dragState}
      onPaste={onPaste}
      {...browserDropHandlers}
      className={joinClassNames(
        'flex flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed text-center transition-colors',
        compact ? 'p-3.5' : 'min-h-[150px] p-[18px]',
        zoneStateClassNames[dragState],
        disabled && 'opacity-60',
        className,
      )}
    >
      <span aria-hidden="true" className={dragState === 'refusing' ? 'text-danger' : dragState === 'accepting' ? 'text-brand' : 'text-muted'}>
        <Icon name="upload" size={compact ? 18 : 22} />
      </span>
      <span className="text-[14px] font-medium text-ink-2">{headline(dragState, itemDescription)}</span>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            clearRejection()
            onChoose()
          }}
        >
          {chooseLabel}
        </Button>
        {secondaryActions}
      </div>
      {hint && (
        <span id={hintId} className="text-[12px] text-muted">
          {hint}
        </span>
      )}
      <span role="status" aria-live="polite" className={joinClassNames('text-[12px]', rejection ? 'text-danger' : 'sr-only')}>
        {statusText}
      </span>
      {children}
    </div>
  )
}
