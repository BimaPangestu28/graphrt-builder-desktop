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

export type PluginTileSize = 'sm' | 'md' | 'lg'

/** Size and corner radius of a plugin tile, shared by the monogram and {@link PluginIcon}. */
export const pluginTileSizeClassNames: Record<PluginTileSize, string> = { sm: 'size-7 rounded-lg', md: 'size-9 rounded-[10px]', lg: 'size-12 rounded-xl' }

const monogramTextClassNames: Record<PluginTileSize, string> = { sm: 'text-[11px]', md: 'text-[12px]', lg: 'text-[15px]' }

/**
 * Two-letter tile standing in for a plugin icon (when the catalog has none or it cannot be
 * loaded), tinted by category so the grid is easy to scan. Decorative: the plugin name is
 * always next to it. Use {@link PluginIcon}, which falls back to this.
 */
export function PluginMonogram({ name, category, size = 'md' }: { name: string; category: PluginCategory; size?: PluginTileSize }) {
  return (
    <span
      aria-hidden="true"
      className={joinClassNames('flex shrink-0 items-center justify-center font-semibold tracking-wide', pluginTileSizeClassNames[size], monogramTextClassNames[size], categoryTintClassNames[category])}
    >
      {pluginMonogram(name)}
    </span>
  )
}
