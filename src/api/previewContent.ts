import { isDesktopApp } from './client'
import type { PreviewContent } from './previewContentTypes'
import { samplePreviewContent } from './sampleBackend/samplePreviewContent'

/**
 * Design content the browser preview (`pnpm dev`, tests) shows next to the sample backend:
 * the sample agents' names, app connections the backend cannot report yet, the Runs screen's
 * default selection and the Scheduler's pinned week and event triggers.
 *
 * Screens read it through here, never from `sampleBackend/` directly, so the desktop build
 * (where `__SAMPLE_BACKEND__` is false) drops it with the rest of the sample backend.
 *
 * @returns The preview content, or null in the desktop app (PreviewContent | null)
 *
 * @example
 * const pinnedToday = getPreviewContent()?.scheduler.todayIsoDate ?? formatZonedIsoDate(new Date(), timezone)
 */
export function getPreviewContent(): PreviewContent | null {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return samplePreviewContent
  return null
}
