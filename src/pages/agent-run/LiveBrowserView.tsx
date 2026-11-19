import { useCallback, useEffect, useState } from 'react'
import { LiveBrowserLightbox } from './LiveBrowserLightbox'
import { useDecodedFrame } from './useDecodedFrame'

/** After this long without a picture, the plugin is probably an older version without live view. */
export const NO_FRAME_HINT_DELAY_MS = 8_000

interface LiveBrowserViewProps {
  /** Latest JPEG data URL of the page, or null before the first one arrives. */
  image: string | null
}

/**
 * A live-updating picture of what the headless browser of a running step sees, shaped like
 * the page itself (16:10 until the first frame says otherwise). A new frame replaces the old
 * one only once decoded, so it does not flicker. Click to enlarge. Shown only while the step
 * runs; nothing is saved with the run.
 */
export function LiveBrowserView({ image }: LiveBrowserViewProps) {
  const [isWaitingLong, setIsWaitingLong] = useState(false)
  const [isEnlarged, setIsEnlarged] = useState(false)
  const frame = useDecodedFrame(image)
  const closeEnlarged = useCallback(() => setIsEnlarged(false), [])
  useEffect(() => {
    if (image) return
    const hintTimer = window.setTimeout(() => setIsWaitingLong(true), NO_FRAME_HINT_DELAY_MS)
    return () => window.clearTimeout(hintTimer)
  }, [image])
  return (
    <figure aria-label="Live view of the browser" className="m-0 flex w-full max-w-[560px] flex-col gap-1">
      <div
        className="flex items-center justify-center overflow-hidden rounded-lg border border-line bg-subtle"
        style={{ aspectRatio: String(frame.aspectRatio) }}
        data-testid="live-browser-frame-box"
      >
        {frame.src ? (
          <button
            type="button"
            aria-label="Enlarge the live view"
            onClick={() => setIsEnlarged(true)}
            className="block size-full cursor-zoom-in border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
          >
            <img src={frame.src} alt="What the browser shows right now" className="block size-full object-contain" />
          </button>
        ) : (
          <span role="status" className="px-4 text-center text-[13px] text-muted">
            {isWaitingLong
              ? 'No picture yet. If this keeps up, update the plugin in Connections: older versions do not send a live view'
              : 'Waiting for the browser…'}
          </span>
        )}
      </div>
      <figcaption className="flex items-center gap-1.5 text-[12px] text-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-danger motion-safe:animate-pulse" />
        Live · stays on this computer, not saved
      </figcaption>
      {isEnlarged && frame.src && <LiveBrowserLightbox src={frame.src} aspectRatio={frame.aspectRatio} onClose={closeEnlarged} />}
    </figure>
  )
}
