import { connectionsTabPath, routePaths } from '@/routes'
import { messages } from '@/i18n'
import { localizedArray } from '@/i18n/localized'
import { getCredentialStoreName } from '@/lib/platform'

/**
 * Content of the onboarding tour, one entry per step, in order. Each line describes
 * something the app really does today; keep it in sync when a feature changes.
 */

export type TourStepId = 'how-it-works' | 'build-with-chat' | 'test-runs' | 'plugins' | 'secrets' | 'runs-schedule-inbox' | 'knowledge' | 'privacy'

export interface TourTryLink {
  label: string
  /** App route opened by the link; following it closes the tour. */
  path: string
}

export interface TourStep {
  id: TourStepId
  title: string
  /** One to three short sentences in plain language. */
  explanation: string
  tryLink?: TourTryLink
}

const tourStepShapes: ReadonlyArray<{ id: TourStepId; tryPath?: string }> = [
  { id: 'how-it-works', tryPath: routePaths.newAgent },
  { id: 'build-with-chat' },
  { id: 'test-runs' },
  { id: 'plugins', tryPath: routePaths.plugins },
  { id: 'secrets', tryPath: connectionsTabPath('secrets') },
  { id: 'runs-schedule-inbox', tryPath: routePaths.runs },
  { id: 'knowledge', tryPath: routePaths.knowledge },
  { id: 'privacy' },
]

function buildTourStep(shape: { id: TourStepId; tryPath?: string }): TourStep {
  const [title, explanation, tryLabel] = messages().misc.tour[shape.id]
  const filledExplanation = explanation.replace('{store}', getCredentialStoreName())
  return { id: shape.id, title, explanation: filledExplanation, ...(shape.tryPath && tryLabel ? { tryLink: { label: tryLabel, path: shape.tryPath } } : {}) }
}

/** The tour in the current language. */
export const tourSteps: readonly TourStep[] = localizedArray(() => tourStepShapes.map(buildTourStep))
