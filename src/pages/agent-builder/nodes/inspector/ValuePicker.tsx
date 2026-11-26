import { useEffect, useRef, useState } from 'react'
import { joinClassNames } from '@/components/ui'
import type { ValueGroup } from './availableValues'
import { messages } from '@/i18n'

/**
 * The "Insert value" list (spec B6): search, one heading per source (loop item, earlier
 * steps, Start, error path, secrets, this run) with type hints, and a box to type a
 * deeper path such as `search_maps.results.0.name`. Picking calls `onPick` with the
 * selector path; the caller decides whether it becomes a chip in text or a selector.
 */
interface ValuePickerProps {
  groups: ValueGroup[]
  onPick: (path: string[]) => void
  onClose: () => void
  /** Highlights the current value of a selector field. */
  selectedPath?: string[] | null
  label?: string
}

function matchesSearch(text: string, search: string): boolean {
  return text.toLowerCase().includes(search.trim().toLowerCase())
}

/** `a.b.c` typed by hand → `['a', 'b', 'c']` when it is a well-formed reference. */
export function parseTypedPath(typed: string): string[] | null {
  const trimmed = typed.trim().replace(/^\{\{#|#\}\}$/g, '')
  const segments = trimmed.split('.')
  return segments.length >= 2 && segments.every((segment) => /^[\p{L}\p{N}_-]+$/u.test(segment)) ? segments : null
}

export function ValuePicker({ groups, onPick, onClose, selectedPath, label = messages().nodes.insertAValueFromAnEarlier }: ValuePickerProps) {
  const [search, setSearch] = useState('')
  const [typedPath, setTypedPath] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => searchRef.current?.focus(), [])
  const selectedKey = selectedPath?.join('.') ?? null
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      options: search.trim() ? group.options.filter((valueOption) => matchesSearch(`${valueOption.label} ${valueOption.path.join('.')} ${group.title}`, search)) : group.options,
    }))
    .filter((group) => group.options.length > 0)
  const typed = parseTypedPath(typedPath)

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2 shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <input
        ref={searchRef}
        type="search"
        aria-label={messages().nodes.searchValues}
        placeholder={messages().nodes.searchValues}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="box-border h-[30px] rounded-[7px] border border-line-strong px-2 text-[12px] outline-none focus:border-ink"
      />
      <div role="listbox" aria-label={label} className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {visibleGroups.length === 0 && <p className="m-0 px-1 text-[12px] text-muted">{messages().nodes.noValuesMatch}</p>}
        {visibleGroups.map((group) => (
          <div key={group.id} role="group" aria-label={group.title} className="flex flex-col">
            <span className="px-1 text-[11px] font-semibold tracking-[0.4px] text-muted uppercase">{group.title}</span>
            {group.note && <span className="px-1 text-[11px] text-muted">{group.note}</span>}
            {group.options.map((valueOption) => {
              const key = valueOption.path.join('.')
              const isSelected = key === selectedKey
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={key}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(valueOption.path)}
                  className={joinClassNames(
                    'flex w-full cursor-pointer justify-between gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-[13px] text-ink',
                    isSelected ? 'bg-brand-soft' : 'bg-transparent hover:bg-subtle',
                  )}
                >
                  <span className="truncate font-mono text-[12px]">{valueOption.label}</span>
                  <span className="shrink-0 text-[11px] text-muted">{valueOption.typeHint}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-1.5 border-t border-chip pt-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (typed) onPick(typed)
        }}
      >
        <input
          aria-label={messages().nodes.typeAValuePath}
          placeholder={messages().nodes.orTypeAPathEG}
          value={typedPath}
          onChange={(event) => setTypedPath(event.target.value)}
          className="box-border h-7 min-w-0 flex-1 rounded-md border border-line-strong px-2 font-mono text-[11px] outline-none focus:border-ink"
        />
        <button type="submit" disabled={!typed} className="h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50">
          {messages().nodes.use}
        </button>
        <button type="button" onClick={onClose} className="h-7 cursor-pointer rounded-md border-0 bg-transparent px-2 text-[12px] text-muted hover:bg-chip">
          {messages().nodes.close}
        </button>
      </form>
    </div>
  )
}
