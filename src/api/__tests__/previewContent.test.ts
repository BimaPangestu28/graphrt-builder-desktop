import { afterEach, describe, expect, it } from 'vitest'
import { getPreviewContent } from '../previewContent'

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('getPreviewContent', () => {
  it('serves the design content in the browser preview', () => {
    const previewContent = getPreviewContent()
    expect(previewContent?.agentNamesById['maps-leads']).toBe('Maps leads to WhatsApp')
    expect(previewContent?.scheduler.eventTriggers.every((trigger) => trigger.iconKind !== 'schedule')).toBe(true)
  })

  it('serves nothing inside the desktop app', () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(getPreviewContent()).toBeNull()
  })
})
