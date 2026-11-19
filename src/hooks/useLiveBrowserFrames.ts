import { useEffect, useState } from 'react'
import { subscribeToLiveView } from '@/api/liveView'
import { applyLiveViewFrame, type LiveBrowserFrame } from '@/pages/agent-run/liveBrowserFrames'

/**
 * Follows the live view frames of open browser pages while `isEnabled` (a step is running).
 * Frames are kept in memory only and dropped when disabled or unmounted.
 *
 * @param isEnabled - Listen only while true (boolean)
 * @returns The open pages with their latest image (LiveBrowserFrame[])
 *
 * @example
 * const frames = useLiveBrowserFrames(steps.some((step) => step.state === 'running'))
 */
export function useLiveBrowserFrames(isEnabled: boolean): LiveBrowserFrame[] {
  const [frames, setFrames] = useState<LiveBrowserFrame[]>([])

  useEffect(() => {
    if (!isEnabled) {
      setFrames([])
      return
    }
    let isCurrent = true
    let unsubscribe: (() => void) | null = null
    subscribeToLiveView((update) => {
      if (isCurrent) setFrames((currentFrames) => applyLiveViewFrame(currentFrames, update))
    })
      .then((stopListening) => {
        if (isCurrent) unsubscribe = stopListening
        else stopListening()
      })
      .catch((subscribeError: unknown) => console.error('Could not follow the live browser view', subscribeError))
    return () => {
      isCurrent = false
      unsubscribe?.()
      setFrames([])
    }
  }, [isEnabled])

  return frames
}
