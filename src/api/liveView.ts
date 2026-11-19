import { listenToBackend } from './client'

/**
 * Live frames of the headless browser a plugin step drives (desktop only). Frames are
 * sent while a page is open and are never stored with the run.
 */

export const LIVE_VIEW_EVENT = 'run-live-view'

/** One update from the desktop's live view watcher (`src-tauri/src/live_view`). */
export interface LiveViewFrame {
  /** One browser page; several pages can be open at once. */
  frameKey: string
  /** The workflow step the page belongs to; null when the plugin does not know it (tool calls). */
  nodeId: string | null
  /** `data:image/jpeg;base64,...`, or null once the page closed. */
  image: string | null
}

/** Live view frames of every run. Returns an unsubscribe function; a no-op outside the desktop app. */
export function subscribeToLiveView(onFrame: (frame: LiveViewFrame) => void): Promise<() => void> {
  return listenToBackend(LIVE_VIEW_EVENT, onFrame)
}
