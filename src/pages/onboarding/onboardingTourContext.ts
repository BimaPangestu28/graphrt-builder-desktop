import { createContext, useContext } from 'react'

/** What screens can do with the onboarding tour. */
export interface OnboardingTourControls {
  /** Opens the tour at its first step. */
  openTour: () => void
}

export const OnboardingTourContext = createContext<OnboardingTourControls | null>(null)

/**
 * The tour controls from `OnboardingTourProvider`.
 *
 * @returns The controls, or null outside the provider (a screen rendered on its own in a
 *   test), where "Take the tour" buttons hide (OnboardingTourControls | null)
 */
export function useOnboardingTour(): OnboardingTourControls | null {
  return useContext(OnboardingTourContext)
}
