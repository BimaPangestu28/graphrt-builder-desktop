import { useEffect, useState } from 'react'
import { previewAgentFile } from '@/api/agentFiles'
import type { FileCard } from '@/api/agentFileTypes'

/** Most previews kept in memory; the oldest goes first. A preview is a few kilobytes of JPEG. */
const maxCachedPreviews = 120

/** Loaded previews by agent and reference, so a chat that renders again does not ask twice. */
const previewCache = new Map<string, string | null>()

function remember(cacheKey: string, dataUrl: string | null): void {
  previewCache.set(cacheKey, dataUrl)
  if (previewCache.size > maxCachedPreviews) {
    const oldestKey = previewCache.keys().next().value
    if (oldestKey !== undefined) previewCache.delete(oldestKey)
  }
}

/** A preview URL is shown only when it is a raster picture the backend encoded itself. */
function isSafePictureUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.startsWith('data:image/png;base64,')
}

/**
 * The small picture a file card shows, loaded from the backend once per file. Only cards whose
 * `preview` is `picture` are asked for; everything else (PDF, HTML, SVG, documents) has none.
 *
 * @param agentId - The agent the file belongs to (string)
 * @param card - The file (FileCard)
 * @returns A `data:image/jpeg` or `data:image/png` URL, or null while loading or when there is no preview (string | null)
 *
 * @example
 * const pictureUrl = useFilePreview(agentId, card)
 */
export function useFilePreview(agentId: string, card: FileCard): string | null {
  const cacheKey = `${agentId}\n${card.reference}`
  const wantsPreview = card.preview === 'picture'
  const [dataUrl, setDataUrl] = useState<string | null>(() => (wantsPreview ? (previewCache.get(cacheKey) ?? null) : null))

  useEffect(() => {
    if (!wantsPreview) {
      setDataUrl(null)
      return
    }
    if (previewCache.has(cacheKey)) {
      setDataUrl(previewCache.get(cacheKey) ?? null)
      return
    }
    let isCurrent = true
    previewAgentFile(agentId, card.reference)
      .then((preview) => {
        const loadedUrl = preview.kind === 'picture' && isSafePictureUrl(preview.dataUrl) ? preview.dataUrl : null
        remember(cacheKey, loadedUrl)
        if (isCurrent) setDataUrl(loadedUrl)
      })
      .catch(() => {
        // No preview is not worth an error: the card still offers the download.
        if (isCurrent) setDataUrl(null)
      })
    return () => {
      isCurrent = false
    }
  }, [agentId, card.reference, cacheKey, wantsPreview])

  return dataUrl
}

/** Forgets every loaded preview (tests). */
export function clearFilePreviewCache(): void {
  previewCache.clear()
}
