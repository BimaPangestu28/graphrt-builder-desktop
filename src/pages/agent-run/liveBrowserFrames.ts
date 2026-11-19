import type { LiveViewFrame } from '@/api/liveView'
import type { RunStepView } from './runSteps'

/** The latest image of each open browser page, in the order the pages last changed. */
export interface LiveBrowserFrame {
  frameKey: string
  nodeId: string | null
  image: string
}

/** Plugins whose steps drive a browser: their running step shows the live view (or its placeholder). */
const browserNodeKindPrefixes = ['google-maps-scraper.', 'web-browser.']

/**
 * Applies one update: a new image replaces the page's previous one (and moves it last),
 * `image: null` removes the page.
 *
 * @param frames - Current pages (LiveBrowserFrame[])
 * @param update - From the desktop (LiveViewFrame)
 * @returns The new list (LiveBrowserFrame[])
 */
export function applyLiveViewFrame(frames: LiveBrowserFrame[], update: LiveViewFrame): LiveBrowserFrame[] {
  const otherFrames = frames.filter((frame) => frame.frameKey !== update.frameKey)
  if (update.image === null) return otherFrames.length === frames.length ? frames : otherFrames
  return [...otherFrames, { frameKey: update.frameKey, nodeId: update.nodeId, image: update.image }]
}

/** Whether the step is a browser plugin step (google-maps-scraper, web-browser). */
export function isBrowserStep(step: RunStepView): boolean {
  return browserNodeKindPrefixes.some((prefix) => step.nodeType?.startsWith(prefix) === true)
}

/**
 * What the live view under each running step shows: the newest image of a page that belongs
 * to the step, else (for the deepest running step) the newest page whose step is not known,
 * e.g. a browser tool an agent step calls.
 *
 * @param steps - The run's steps in display order (RunStepView[])
 * @param frames - Open pages (LiveBrowserFrame[])
 * @returns Step id to image, or to null for a browser step still waiting for its first image;
 *   steps without a live view are left out (Map<string, string | null>)
 */
export function pickStepLiveViews(steps: RunStepView[], frames: LiveBrowserFrame[]): Map<string, string | null> {
  const liveViews = new Map<string, string | null>()
  const runningSteps = steps.filter((step) => step.state === 'running')
  const deepestRunningStep = runningSteps.reduce<RunStepView | null>((deepest, step) => (!deepest || step.depth >= deepest.depth ? step : deepest), null)
  const unknownStepImage = newestImage(frames.filter((frame) => frame.nodeId === null))
  for (const step of runningSteps) {
    const image = newestImage(frames.filter((frame) => frame.nodeId === step.id)) ?? (step === deepestRunningStep ? unknownStepImage : null)
    if (image !== null) liveViews.set(step.id, image)
    else if (isBrowserStep(step)) liveViews.set(step.id, null)
  }
  return liveViews
}

function newestImage(frames: LiveBrowserFrame[]): string | null {
  return frames.at(-1)?.image ?? null
}
