import { useEffect, useRef, type KeyboardEvent } from 'react'
import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'

/**
 * The right-click menus of the canvas (spec I1). On a node: Add node after, Change action
 * (plugin steps), Ask the builder about this, Duplicate, Disconnect, Delete. On the empty
 * canvas: Add node here, Add note here, Paste, Fit. A real menu: arrow keys move, Enter
 * picks, Esc and a click outside close it.
 */

export type NodeMenuAction = 'add-after' | 'change-action' | 'ask-builder' | 'duplicate' | 'disconnect' | 'delete'

/** Actions of the empty-canvas menu. */
export type PaneMenuAction = 'add-node-here' | 'add-note-here' | 'paste' | 'fit'

export interface CanvasMenuItem<Action extends string = string> {
  action: Action
  label: string
  shortcut?: string
  isDanger?: boolean
  /** Changes the graph: off while the canvas is read-only. */
  edits: boolean
  /** Draws a line above this entry. */
  separatorBefore?: boolean
}

type NodeMenuItem = CanvasMenuItem<NodeMenuAction>

/** Menu entries for a node; Change action only for plugin steps. */
export function listNodeMenuItems(options: { isPluginNode: boolean; isMac: boolean; selectionSize: number }): NodeMenuItem[] {
  const command = options.isMac ? '⌘' : 'Ctrl+'
  const single = options.selectionSize <= 1
  return [
    ...(single ? [{ action: 'add-after' as const, label: messages().nodes.addNodeAfter, shortcut: 'A', edits: true }] : []),
    ...(single && options.isPluginNode ? [{ action: 'change-action' as const, label: messages().nodes.changeAction, edits: true }] : []),
    { action: 'ask-builder', label: single ? messages().nodes.askTheBuilderAboutThis : messages().nodes.askTheBuilderAboutThese, edits: false },
    { action: 'duplicate', label: messages().nodes.duplicate, shortcut: `${command}D`, edits: true, separatorBefore: true },
    { action: 'disconnect', label: messages().nodes.disconnect, edits: true },
    { action: 'delete', label: messages().nodes.delete, shortcut: '⌫', isDanger: true, edits: true },
  ]
}

/** Entries of the empty-canvas menu. */
export function listPaneMenuItems(options: { isMac: boolean; canAddNode: boolean; canAddNote: boolean; canPaste: boolean }): CanvasMenuItem<PaneMenuAction>[] {
  const command = options.isMac ? '⌘' : 'Ctrl+'
  return [
    ...(options.canAddNode ? [{ action: 'add-node-here' as const, label: messages().nodes.addNodeHere, shortcut: 'A', edits: true }] : []),
    ...(options.canAddNote ? [{ action: 'add-note-here' as const, label: messages().nodes.addNoteHere, edits: true }] : []),
    ...(options.canPaste ? [{ action: 'paste' as const, label: messages().nodes.paste, shortcut: `${command}V`, edits: true }] : []),
    { action: 'fit', label: messages().nodes.fitTheWholeAgent, shortcut: '⇧1', edits: false, separatorBefore: options.canAddNode || options.canAddNote || options.canPaste },
  ]
}

interface NodeContextMenuProps<Action extends string> {
  /** Where it opens, relative to the canvas box. */
  position: { x: number; y: number }
  title: string
  items: CanvasMenuItem<Action>[]
  readOnly: boolean
  onAction: (action: Action) => void
  onClose: () => void
}

export function NodeContextMenu<Action extends string>({ position, title, items, readOnly, onAction, onClose }: NodeContextMenuProps<Action>) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
    function closeOnOutsidePointer(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [onClose])

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const menuItems = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) {
      // Keys inside the menu never reach the canvas shortcuts.
      if (event.key !== 'Enter' && event.key !== ' ') event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    menuItems[(currentIndex + step + menuItems.length) % menuItems.length]?.focus()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={messages().nodes.actionsForTitle(title)}
      onKeyDown={moveFocus}
      onContextMenu={(event) => event.preventDefault()}
      className="nodrag nopan absolute z-30 box-border flex w-[236px] flex-col gap-px rounded-xl border border-line bg-surface p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, itemIndex) => (
        <div key={item.action}>
          {item.separatorBefore && itemIndex > 0 && <div role="separator" className="mx-1 my-1 h-px bg-line" />}
          <button
            type="button"
            role="menuitem"
            disabled={readOnly && item.edits}
            onClick={() => {
              onAction(item.action)
              onClose()
            }}
            className={joinClassNames(
              'flex h-8 w-full cursor-pointer items-center justify-between rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-medium hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none disabled:cursor-default disabled:opacity-50',
              item.isDanger ? 'text-danger' : 'text-ink',
            )}
          >
            {item.label}
            {item.shortcut && <span className="text-[12px] font-normal text-muted">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
