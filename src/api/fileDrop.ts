import { isDesktopApp } from './client'
import type { WindowDragDropEvent } from '@/lib/fileDropRouter'

/**
 * Files dragged onto the desktop window and the generic file picker.
 *
 * In the desktop app Tauri reports drags for the whole webview with real filesystem paths;
 * {@link subscribeToWindowDragDrop} converts its physical pixel positions to CSS pixels so the
 * drop zone router can hit-test elements. The browser preview has no such events (zones use
 * HTML drag and drop there), so the subscription does nothing.
 */

/**
 * Listens to files dragged over and dropped on the app window (desktop only).
 *
 * @param onEvent - Called for enter, over, drop and leave
 * @returns An unsubscribe function
 */
export async function subscribeToWindowDragDrop(onEvent: (event: WindowDragDropEvent) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {}
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'leave') {
      onEvent({ type: 'leave' })
      return
    }
    const scale = window.devicePixelRatio || 1
    const position = { x: payload.position.x / scale, y: payload.position.y / scale }
    if (payload.type === 'over') onEvent({ type: 'over', position })
    else onEvent({ type: payload.type, paths: payload.paths, position })
  })
}

/**
 * Opens the system picker for one or several files of any type (desktop only).
 *
 * @param title - Dialog title (string)
 * @param multiple - Allow several files (boolean)
 * @returns Absolute paths, empty when the picker was closed (string[])
 */
export async function pickFilePaths(title: string, multiple: boolean): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ title, multiple, directory: false })
  if (!picked) return []
  return Array.isArray(picked) ? picked : [picked]
}
