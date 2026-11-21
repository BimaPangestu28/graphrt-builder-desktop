import type { ReactNode } from 'react'
import type { NodeKindGroup } from '@/api/agentGraphTypes'
import { joinClassNames, StrokeIcon } from '@/components/ui'
import { PluginIcon } from '@/pages/plugins/PluginIcon'
import type { PaletteAction } from './paletteCatalog'
import { startNodeKindDrag } from './paletteDrag'

/** Line icon per built-in group, so the list scans like the library (artboard 46). */
const groupIconPaths: Record<NodeKindGroup, ReactNode> = {
  'start-and-finish': <path d="M8 5v14l11-7z" />,
  ai: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  connect: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  'decide-and-wait': <path d="M6 3v6a6 6 0 0 0 6 6h6M6 21v-6M15 12l3 3-3 3" />,
  repeat: <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  data: <path d="M4 6h16M4 12h16M4 18h10" />,
  plugin: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />,
  hidden: <circle cx="12" cy="12" r="2" />,
  other: <path d="M12 3l9 9-9 9-9-9z" />,
}

/** DOM id of an option, for `aria-activedescendant`. */
export function paletteOptionId(kind: string): string {
  return `palette-option-${kind.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** The name with the matched parts marked (search results). */
function HighlightedName({ name, highlights }: { name: string; highlights: Array<[number, number]> }) {
  if (highlights.length === 0) return <>{name}</>
  const parts: Array<{ text: string; isMatch: boolean }> = []
  let cursor = 0
  for (const [start, end] of highlights) {
    if (start > cursor) parts.push({ text: name.slice(cursor, start), isMatch: false })
    parts.push({ text: name.slice(start, end), isMatch: true })
    cursor = end
  }
  if (cursor < name.length) parts.push({ text: name.slice(cursor), isMatch: false })
  return (
    <>
      {parts.map((part, partIndex) =>
        part.isMatch ? (
          <mark key={partIndex} className="rounded-[3px] bg-amber-soft px-px font-semibold text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={partIndex}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** Shrinks the plugin tile (made for cards) to the row's size. */
const compactTileClassNames = {
  browse: '[&>span]:!size-8 [&>span]:!rounded-lg [&>span]:!text-[11px]',
  result: '[&>span]:!size-6 [&>span]:!rounded-md [&>span]:!p-1 [&>span]:!text-[9px]',
}

function ActionTile({ action, variant }: { action: PaletteAction; variant: 'browse' | 'result' }) {
  if (action.plugin) {
    return (
      <span className={joinClassNames('flex shrink-0', compactTileClassNames[variant])}>
        <PluginIcon name={action.plugin.name} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={joinClassNames('flex shrink-0 items-center justify-center bg-subtle text-ink-2', variant === 'browse' ? 'size-8 rounded-lg' : 'size-6 rounded-md')}>
      <StrokeIcon size={variant === 'browse' ? 16 : 13}>{groupIconPaths[action.group]}</StrokeIcon>
    </span>
  )
}

function StatusBadge({ action }: { action: PaletteAction }) {
  if (!action.plugin) return null
  if (action.plugin.installed) return <span className="shrink-0 text-[11px] font-medium text-ok-strong">Installed</span>
  return <span className="shrink-0 rounded-md border border-line-strong bg-surface px-1.5 py-px text-[11px] font-semibold text-ink">Install</span>
}

interface PaletteOptionRowProps {
  action: PaletteAction
  isActive: boolean
  /** `browse`: name over kind or description; `result`: "Plugin › name" with the match highlighted. */
  variant: 'browse' | 'result'
  /** Show the plugin tile (browse rows inside a plugin's group leave it out). */
  showTile?: boolean
  highlights?: Array<[number, number]>
  isDisabled: boolean
  onSelect: (action: PaletteAction) => void
  onActivate: (action: PaletteAction) => void
  onDragKind: (action: PaletteAction | null) => void
}

/**
 * One thing the palette can add: click or Enter adds it, drag puts it on the canvas.
 * Not-installed plugin actions show "Install" and open the approval instead.
 */
export function PaletteOptionRow({ action, isActive, variant, showTile = true, highlights = [], isDisabled, onSelect, onActivate, onDragKind }: PaletteOptionRowProps) {
  const subtitle = variant === 'browse' ? (action.plugin ? action.description : action.kind) : null
  return (
    <li
      id={paletteOptionId(action.kind)}
      role="option"
      aria-selected={isActive}
      aria-disabled={isDisabled || undefined}
      data-kind={action.kind}
      title={action.plugin ? `${action.plugin.displayName} › ${action.displayName}` : action.displayName}
      draggable={!isDisabled}
      onDragStart={(event) => {
        startNodeKindDrag(event.dataTransfer, action.kind)
        onDragKind(action)
      }}
      onDragEnd={() => onDragKind(null)}
      onMouseMove={() => !isActive && onActivate(action)}
      onClick={() => !isDisabled && onSelect(action)}
      className={joinClassNames(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2',
        variant === 'result' ? 'py-1.5' : 'py-1',
        isActive ? 'bg-selected' : 'hover:bg-subtle',
        isDisabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {showTile && <ActionTile action={action} variant={variant} />}
      <span className="flex min-w-0 flex-1 flex-col">
        {variant === 'result' ? (
          <span className="truncate text-[13px] text-ink">
            {action.plugin && <span className="text-muted">{action.plugin.displayName} › </span>}
            <HighlightedName name={action.displayName} highlights={highlights} />
          </span>
        ) : (
          <span className="truncate text-[13px] font-medium text-ink">{action.displayName}</span>
        )}
        {subtitle && <span className={joinClassNames('truncate text-[11px] text-muted', !action.plugin && 'font-mono')}>{subtitle}</span>}
      </span>
      {(variant === 'result' || (action.plugin && !action.plugin.installed)) && <StatusBadge action={action} />}
    </li>
  )
}
