import type { ReactNode } from 'react'
import { joinClassNames, StrokeIcon } from '@/components/ui'
import { PluginIcon } from '@/pages/plugins/PluginIcon'

/**
 * The logo tile of a node card (spec N1): the plugin's catalog icon (else its
 * two-letter tile), or a line icon for the builtin kind. Decorative: the card names
 * the step next to it.
 */

const kindIconPaths: Record<string, ReactNode> = {
  start: <path d="M8 5v14l11-7z" />,
  end: <path d="M5 21V4h11l-2 4 2 4H5" />,
  answer: <path d="M4 5h16v11H8l-4 4z" />,
  llm: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  agent: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9 13v1M15 13v1" />
    </>
  ),
  'question-classifier': <path d="M4 6h16M4 12h10M4 18h6" />,
  'parameter-extractor': <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8M8 13h5" />,
  'knowledge-retrieval': <path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11" />,
  'http-request': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </>
  ),
  tool: <path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-2.5z" />,
  'if-else': <path d="M6 3v6a6 6 0 006 6h6M18 15l-3-3M18 15l-3 3M6 21v-6" />,
  'human-input': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  iteration: <path d="M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5" />,
  loop: <path d="M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5" />,
  'loop-end': <rect x="6" y="6" width="12" height="12" rx="2" />,
  'template-transform': <path d="M5 6h14M12 6v13M9 19h6" />,
  'list-operator': <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  'variable-aggregator': <path d="M5 5l7 7-7 7M12 12h8" />,
  assigner: <path d="M6 4h12v16l-6-4-6 4z" />,
  'variable-assigner': <path d="M6 4h12v16l-6-4-6 4z" />,
}

const fallbackIconPath = <rect x="5" y="5" width="14" height="14" rx="3" />

export type NodeKindIconTone = 'neutral' | 'amber'

const toneClassNames: Record<NodeKindIconTone, string> = {
  neutral: 'bg-canvas text-ink-2',
  amber: 'bg-amber-soft text-amber-strong',
}

interface NodeKindIconProps {
  kind: string
  /** Plugin name for plugin kinds: shows its catalog icon or monogram. */
  pluginName: string | null
  tone?: NodeKindIconTone
  size?: 'sm' | 'md'
}

/** A node's logo tile (28 px, 22 px when compact-small). */
export function NodeKindIcon({ kind, pluginName, tone = 'neutral', size = 'md' }: NodeKindIconProps) {
  if (pluginName) return <PluginIcon name={pluginName} size="sm" />
  return (
    <span aria-hidden="true" className={joinClassNames('flex shrink-0 items-center justify-center rounded-lg', size === 'md' ? 'size-7' : 'size-[22px]', toneClassNames[tone])}>
      <StrokeIcon size={size === 'md' ? 15 : 12}>{kindIconPaths[kind] ?? fallbackIconPath}</StrokeIcon>
    </span>
  )
}
