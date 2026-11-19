import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui'
import type { Agent } from '@/api/types'

const menuItemClassNames =
  'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13px] text-ink hover:bg-chip focus-visible:bg-chip focus-visible:outline-none'

interface AgentCardMenuProps {
  agent: Agent
  onRename: () => void
  onDelete: () => void
}

/**
 * The "⋯" button on a Home agent card with Rename and Delete. Opens below the button; closes on
 * Escape, on a click outside, or after choosing. Arrow keys move between the two items.
 */
export function AgentCardMenu({ agent, onRename, onDelete }: AgentCardMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!isOpen) return
    itemRefs.current[0]?.focus()
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [isOpen])

  function close() {
    setIsOpen(false)
    buttonRef.current?.focus()
  }

  function choose(action: () => void) {
    setIsOpen(false)
    action()
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(currentIndex + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More actions for ${agent.name}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-chip hover:text-ink"
      >
        <Icon name="more" size={18} />
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for ${agent.name}`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-9 z-10 flex min-w-40 flex-col overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        >
          <button ref={(element) => (itemRefs.current[0] = element)} type="button" role="menuitem" onClick={() => choose(onRename)} className={menuItemClassNames}>
            <Icon name="edit" size={14} />
            Rename
          </button>
          <button
            ref={(element) => (itemRefs.current[1] = element)}
            type="button"
            role="menuitem"
            onClick={() => choose(onDelete)}
            className={`${menuItemClassNames} !text-danger`}
          >
            <Icon name="trash" size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
