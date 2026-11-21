import { useEffect, useRef, type KeyboardEvent } from 'react'
import { joinClassNames } from '@/components/ui'

/**
 * The right-click menu of a node (spec I1): Add node after, Change action (plugin
 * steps), Ask the builder about this, Duplicate, Disconnect, Delete. A real menu:
 * arrow keys move, Enter picks, Esc and a click outside close it.
 */

export type NodeMenuAction = 'add-after' | 'change-action' | 'ask-builder' | 'duplicate' | 'disconnect' | 'delete'

interface NodeMenuItem {
  action: NodeMenuAction
  label: string
  shortcut?: string
  isDanger?: boolean
  /** Changes the graph: off while the canvas is read-only. */
  edits: boolean
}

/** Menu entries for a node; Change action only for plugin steps. */
export function listNodeMenuItems(options: { isPluginNode: boolean; isMac: boolean; selectionSize: number }): NodeMenuItem[] {
  const command = options.isMac ? '⌘' : 'Ctrl+'
  const single = options.selectionSize <= 1
  return [
    ...(single ? [{ action: 'add-after' as const, label: 'Add node after', shortcut: 'A', edits: true }] : []),
    ...(single && options.isPluginNode ? [{ action: 'change-action' as const, label: 'Change action', edits: true }] : []),
    { action: 'ask-builder', label: single ? 'Ask the builder about this' : 'Ask the builder about these', edits: false },
    { action: 'duplicate', label: 'Duplicate', shortcut: `${command}D`, edits: true },
    { action: 'disconnect', label: 'Disconnect', edits: true },
    { action: 'delete', label: 'Delete', shortcut: '⌫', isDanger: true, edits: true },
  ]
}

interface NodeContextMenuProps {
  /** Where it opens, relative to the canvas box. */
  position: { x: number; y: number }
  title: string
  items: NodeMenuItem[]
  readOnly: boolean
  onAction: (action: NodeMenuAction) => void
  onClose: () => void
}

export function NodeContextMenu({ position, title, items, readOnly, onAction, onClose }: NodeContextMenuProps) {
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
      aria-label={`Actions for ${title}`}
      onKeyDown={moveFocus}
      onContextMenu={(event) => event.preventDefault()}
      className="nodrag nopan absolute z-30 box-border flex w-[236px] flex-col gap-px rounded-xl border border-line bg-surface p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, itemIndex) => (
        <div key={item.action}>
          {item.action === 'duplicate' && itemIndex > 0 && <div role="separator" className="mx-1 my-1 h-px bg-line" />}
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
