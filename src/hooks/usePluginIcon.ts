import { useEffect, useState } from 'react'
import { getPluginIcon } from '@/api/plugins'

/**
 * One request per plugin icon for the whole session: the Plugins grid, a plugin's page
 * and the builder's setup card share it. Keyed by name and icon link, so a catalog that
 * points a plugin at a new icon asks again.
 */
const iconRequestsByKey = new Map<string, Promise<string | null>>()

function toIconRequestKey(pluginName: string, iconUrl: string | undefined): string {
  return `${pluginName}\n${iconUrl ?? ''}`
}

/**
 * The plugin's icon as a data URL, from the backend's on-disk cache (fetched once).
 *
 * @param pluginName - Plugin name, e.g. "whatsapp-web" (string)
 * @param iconUrl - The catalog's icon link when known; undefined lets the backend look it up (string | undefined)
 * @returns The data URL, or null when there is no icon or it could not be loaded (Promise<string | null>)
 */
export function loadPluginIcon(pluginName: string, iconUrl?: string): Promise<string | null> {
  const requestKey = toIconRequestKey(pluginName, iconUrl)
  const pendingRequest = iconRequestsByKey.get(requestKey)
  if (pendingRequest) return pendingRequest
  const iconRequest = getPluginIcon(pluginName).catch((rawError: unknown) => {
    // The icon is decoration: the placeholder stays and the rest of the page works.
    console.warn(`Could not load the icon of plugin ${pluginName}`, rawError)
    return null
  })
  iconRequestsByKey.set(requestKey, iconRequest)
  return iconRequest
}

/** Forgets every loaded icon (tests, or after the catalog changes). */
export function clearPluginIconCache(): void {
  iconRequestsByKey.clear()
}

/**
 * A plugin's icon data URL for an `<img>`, or null while loading and when there is none.
 *
 * @param pluginName - Plugin name (string)
 * @param iconUrl - The catalog's icon link; null means "no icon" and skips the request (string | null | undefined)
 * @returns The data URL or null (string | null)
 *
 * @example
 * const iconDataUrl = usePluginIcon(item.name, item.iconUrl)
 */
export function usePluginIcon(pluginName: string, iconUrl: string | null | undefined): string | null {
  const requestKey = iconUrl === null ? null : toIconRequestKey(pluginName, iconUrl)
  const [loadedIcon, setLoadedIcon] = useState<{ requestKey: string; dataUrl: string } | null>(null)

  useEffect(() => {
    if (iconUrl === null) return
    let isCurrent = true
    const currentKey = toIconRequestKey(pluginName, iconUrl)
    void loadPluginIcon(pluginName, iconUrl).then((dataUrl) => {
      // No icon renders the same as "still loading", so only an icon needs a re-render.
      if (isCurrent && dataUrl) setLoadedIcon({ requestKey: currentKey, dataUrl })
    })
    return () => {
      isCurrent = false
    }
  }, [pluginName, iconUrl])

  if (requestKey === null || loadedIcon?.requestKey !== requestKey) return null
  return loadedIcon.dataUrl
}
