import { useEffect, useState } from 'react'

/** Shape of the box before the first frame: the plugins' usual 1280x800 viewport. */
export const PLACEHOLDER_ASPECT_RATIO = 16 / 10
/** Frames narrower or wider than this are letterboxed instead of making the box very tall or flat. */
const MIN_ASPECT_RATIO = 0.75
const MAX_ASPECT_RATIO = 2.5

/** The frame that is ready to paint, and the shape of the box it fills. */
export interface DecodedFrame {
  /** The JPEG data URL to show, or null before the first frame. */
  src: string | null
  /** width / height of the latest frame, clamped; the placeholder ratio until one is known. */
  aspectRatio: number
}

/**
 * width / height of a loaded image, kept within a sensible range.
 *
 * @param naturalWidth - Pixel width of the image (number)
 * @param naturalHeight - Pixel height of the image (number)
 * @returns The clamped ratio, or null when the size is unknown (number | null)
 *
 * @example
 * readFrameAspectRatio(960, 540) // 1.777…
 */
export function readFrameAspectRatio(naturalWidth: number, naturalHeight: number): number | null {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, naturalWidth / naturalHeight))
}

/**
 * Follows a stream of frame data URLs, switching to a new one only once it has decoded, so
 * the picture never blanks or flickers between frames. A frame that fails to decode is
 * skipped (the previous one stays). Also reports the frame's real shape for the box.
 *
 * @param image - Latest frame data URL, or null when there is none (string | null)
 * @returns The frame to paint and its aspect ratio (DecodedFrame)
 *
 * @example
 * const { src, aspectRatio } = useDecodedFrame(image)
 */
export function useDecodedFrame(image: string | null): DecodedFrame {
  const [shownImage, setShownImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState(PLACEHOLDER_ASPECT_RATIO)

  useEffect(() => {
    if (!image) {
      setShownImage(null)
      return
    }
    let isCurrent = true
    const loader = new Image()
    const showDecodedFrame = () => {
      if (!isCurrent) return
      setShownImage(image)
      const frameAspectRatio = readFrameAspectRatio(loader.naturalWidth, loader.naturalHeight)
      if (frameAspectRatio !== null) setAspectRatio(frameAspectRatio)
    }
    loader.src = image
    if (typeof loader.decode !== 'function') {
      showDecodedFrame()
    } else {
      loader.decode().then(showDecodedFrame, () => {
        // A broken frame: keep showing the previous one until the next arrives.
      })
    }
    return () => {
      isCurrent = false
    }
  }, [image])

  return { src: image ? shownImage : null, aspectRatio }
}
