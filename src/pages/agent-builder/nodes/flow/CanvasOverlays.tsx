import { useEffect, useRef } from 'react'
import { joinClassNames, StrokeIcon } from '@/components/ui'
import { listShortcutHelp } from './shortcuts'
import { messages } from '@/i18n'

/**
 * The canvas's floating parts (spec A, I1): zoom controls with Fit and the shortcuts
 * button, the shortcuts panel, the bar for a multi-selection, and the empty state.
 */

const floatingBoxClassNames = 'nodrag nopan box-border rounded-[10px] border border-line bg-surface shadow-sm'
const iconButtonClassNames = 'flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 hover:bg-subtle disabled:cursor-default disabled:opacity-40'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onShowShortcuts: () => void
  /** Px covered on the left by a floating panel; the controls sit right of it. */
  insetLeft?: number
  /** Whether the minimap shows, and its toggle (absent: no Map button). */
  isMinimapShown?: boolean
  onToggleMinimap?: () => void
  /** A very narrow canvas: only zoom and Fit. */
  isTight?: boolean
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onFit, onShowShortcuts, insetLeft = 0, isMinimapShown = false, onToggleMinimap, isTight = false }: ZoomControlsProps) {
  return (
    <div role="group" aria-label={messages().nodes.zoom} className={joinClassNames(floatingBoxClassNames, 'absolute bottom-4 z-10 flex items-center gap-0.5 p-0.5')} style={{ left: 16 + insetLeft }}>
      <button type="button" aria-label={messages().nodes.zoomOut} onClick={onZoomOut} className={iconButtonClassNames}>
        <StrokeIcon size={14}>
          <path d="M5 12h14" />
        </StrokeIcon>
      </button>
      <span aria-live="polite" aria-label={messages().nodes.zoomValue(Math.round(zoom * 100))} className="min-w-11 text-center text-[12px] font-medium text-ink-2">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label={messages().nodes.zoomIn} onClick={onZoomIn} className={iconButtonClassNames}>
        <StrokeIcon size={14}>
          <path d="M12 5v14M5 12h14" />
        </StrokeIcon>
      </button>
      <span aria-hidden="true" className="mx-0.5 h-[18px] w-px bg-line" />
      <button type="button" onClick={onFit} className="h-8 cursor-pointer rounded-lg border-0 bg-transparent px-2.5 text-[12px] font-medium text-ink-2 hover:bg-subtle">
        {messages().nodes.fit}
      </button>
      {onToggleMinimap && !isTight && (
        <button
          type="button"
          aria-pressed={isMinimapShown}
          aria-label={isMinimapShown ? messages().nodes.hideTheMinimap : messages().nodes.showTheMinimap}
          title={isMinimapShown ? messages().nodes.hideTheMinimap : messages().nodes.showTheMinimap}
          onClick={onToggleMinimap}
          className={joinClassNames(iconButtonClassNames, isMinimapShown ? 'bg-subtle text-ink' : '')}
        >
          <StrokeIcon size={15}>
            <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />
          </StrokeIcon>
        </button>
      )}
      {!isTight && (
        <>
          <span aria-hidden="true" className="mx-0.5 h-[18px] w-px bg-line" />
          <button type="button" aria-label={messages().nodes.keyboardShortcuts} onClick={onShowShortcuts} className={joinClassNames(iconButtonClassNames, 'text-[13px] font-semibold')}>
            ?
          </button>
        </>
      )}
    </div>
  )
}

export function ShortcutsPanel({ isMac, onClose }: { isMac: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="node-shortcuts-title"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') onClose()
      }}
      className={joinClassNames(floatingBoxClassNames, 'absolute bottom-16 left-4 z-30 flex w-[340px] flex-col gap-2 rounded-xl p-4 shadow-lg')}
    >
      <div className="flex items-center justify-between">
        <h2 id="node-shortcuts-title" className="m-0 text-[14px] font-semibold text-ink">
          {messages().nodes.keyboardShortcuts}
        </h2>
        <button ref={closeRef} type="button" aria-label={messages().nodes.closeKeyboardShortcuts} onClick={onClose} className={iconButtonClassNames}>
          <StrokeIcon size={14}>
            <path d="M6 6l12 12M18 6L6 18" />
          </StrokeIcon>
        </button>
      </div>
      <span className="text-[12px] text-muted">{isMac ? messages().nodes.ctrlInsteadOfOnWindowsAnd : messages().nodes.insteadOfCtrlOnMacos} {messages().nodes.openWith}</span>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
        {listShortcutHelp(isMac).map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-body">{row.label}</dt>
            <dd className="m-0 text-right font-medium text-ink">{row.keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

interface SelectionBarProps {
  count: number
  readOnly: boolean
  onDuplicate: () => void
  onAskBuilder: () => void
  onDelete: () => void
}

/** "2 selected · Duplicate · Ask the builder · Delete" while several steps are selected. */
export function SelectionBar({ count, readOnly, onDuplicate, onAskBuilder, onDelete }: SelectionBarProps) {
  const buttonClassNames = 'h-8 cursor-pointer whitespace-nowrap rounded-lg border-0 bg-transparent px-2.5 text-[13px] font-medium hover:bg-subtle disabled:cursor-default disabled:opacity-50'
  return (
    <div role="toolbar" aria-label={messages().nodes.countSelected(count)} className={joinClassNames(floatingBoxClassNames, 'absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl p-1 shadow-md')}>
      <span className="whitespace-nowrap px-2.5 text-[13px] font-semibold text-ink">{count} {messages().nodes.selected}</span>
      <span aria-hidden="true" className="h-[18px] w-px bg-line" />
      <button type="button" disabled={readOnly} onClick={onDuplicate} className={joinClassNames(buttonClassNames, 'text-ink')}>
        {messages().nodes.duplicate}
      </button>
      <button type="button" onClick={onAskBuilder} className={joinClassNames(buttonClassNames, 'text-ink')}>
        {messages().nodes.askTheBuilder}
      </button>
      <button type="button" disabled={readOnly} onClick={onDelete} className={joinClassNames(buttonClassNames, 'text-danger')}>
        {messages().nodes.delete}
      </button>
    </div>
  )
}

interface EmptyCanvasProps {
  readOnly: boolean
  onAddNode?: () => void
  onWriteInChat?: () => void
}

/** A new agent with nothing after Start (spec I1 "A new agent"). */
export function EmptyCanvas({ readOnly, onAddNode, onWriteInChat }: EmptyCanvasProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <div className={joinClassNames(floatingBoxClassNames, 'pointer-events-auto flex max-w-[380px] flex-col items-center gap-3 rounded-2xl px-6 py-5 text-center shadow-md')}>
        <h2 className="m-0 text-[15px] font-semibold text-ink">{messages().nodes.describeItInChatOrAdd}</h2>
        <p className="m-0 text-[13px] leading-[1.5] text-body">{messages().nodes.theBuilderTurnsADescriptionInto}</p>
        <div className="flex gap-2">
          {onAddNode && (
            <button type="button" disabled={readOnly} onClick={onAddNode} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-ink bg-ink px-3 text-[13px] font-semibold text-white hover:bg-ink-2 disabled:cursor-default disabled:opacity-50">
              <StrokeIcon size={14}>
                <path d="M12 5v14M5 12h14" />
              </StrokeIcon>
              {messages().nodes.addNode}
            </button>
          )}
          {onWriteInChat && (
            <button type="button" onClick={onWriteInChat} className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-subtle">
              {messages().nodes.writeInChat}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
