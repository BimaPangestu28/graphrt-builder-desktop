import { useState } from 'react'
import { joinClassNames } from '@/components/ui'
import { usePluginIcon } from '@/hooks/usePluginIcon'
import { categorizePlugin, type PluginCategory } from './pluginCategories'
import { PluginMonogram, pluginTileSizeClassNames, type PluginTileSize } from './PluginMonogram'

interface PluginIconProps {
  name: string
  /** The catalog's icon link: null skips loading (no icon); undefined lets the backend look it up by name. */
  iconUrl?: string | null
  /** Tint of the placeholder; derived from the name when not given. */
  category?: PluginCategory
  size?: PluginTileSize
}

/**
 * A plugin's catalog icon, or its monogram tile while loading, when it has none, or when
 * the image fails. The icon is a data URL from the backend's cache shown with `<img>`, so
 * scripts inside the SVG never run. Decorative: the plugin name is always next to it.
 */
export function PluginIcon({ name, iconUrl, category, size = 'md' }: PluginIconProps) {
  const iconDataUrl = usePluginIcon(name, iconUrl)
  const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null)
  if (!iconDataUrl || iconDataUrl === failedDataUrl) {
    return <PluginMonogram name={name} category={category ?? categorizePlugin(name, '')} size={size} />
  }
  return (
    <span
      aria-hidden="true"
      data-testid="plugin-icon"
      className={joinClassNames('flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface', size === 'sm' ? 'p-1' : 'p-1.5', pluginTileSizeClassNames[size])}
    >
      <img src={iconDataUrl} alt="" draggable={false} className="size-full object-contain" onError={() => setFailedDataUrl(iconDataUrl)} />
    </span>
  )
}
