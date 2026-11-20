import { joinClassNames } from '@/components/ui'
import type { PluginCategory } from './pluginCategories'
import { pluginMonogram } from './pluginDisplay'

const categoryTintClassNames: Record<PluginCategory, string> = {
  messaging: 'bg-ok-soft text-ok-strong',
  ai: 'bg-brand-soft text-brand-strong',
  data: 'bg-selected text-ink-2',
  files: 'bg-amber-soft text-amber-strong',
  commerce: 'bg-ok-soft text-ok-strong',
  marketing: 'bg-amber-soft text-amber-strong',
  productivity: 'bg-brand-soft text-brand-strong',
  web: 'bg-brand-tint text-brand',
  developer: 'bg-selected text-ink',
  other: 'bg-chip text-ink-2',
}

const sizeClassNames = { md: 'size-9 rounded-[10px] text-[12px]', lg: 'size-12 rounded-xl text-[15px]' }

/**
 * Two-letter tile standing in for a plugin icon (the catalog has none), tinted by category
 * so the grid is easy to scan. Decorative: the plugin name is always next to it.
 */
export function PluginMonogram({ name, category, size = 'md' }: { name: string; category: PluginCategory; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={joinClassNames('flex shrink-0 items-center justify-center font-semibold tracking-wide', sizeClassNames[size], categoryTintClassNames[category])}
    >
      {pluginMonogram(name)}
    </span>
  )
}
