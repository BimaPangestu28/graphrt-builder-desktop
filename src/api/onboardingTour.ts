import { callBackend, isDesktopApp } from './client'
import { sampleOnboardingTourBackend } from './sampleBackend/onboardingTour'

/**
 * Whether the onboarding tour was completed, skipped or not seen yet. Mirrors
 * `OnboardingTourStatus` in `src-tauri/src/desktop/onboarding_tour.rs`, stored in the
 * app database apart from the Settings preferences.
 */
export type OnboardingTourStatus = 'not_seen' | 'completed' | 'skipped'

/** Reads the stored tour status; a fresh install answers `not_seen`. */
export function getOnboardingTourStatus(): Promise<OnboardingTourStatus> {
  if (!isDesktopApp()) return sampleOnboardingTourBackend.getOnboardingTourStatus()
  return callBackend('get_onboarding_tour_status')
}

/**
 * Remembers how the tour ended, so it opens by itself only once.
 *
 * @throws BackendError - when the status cannot be saved
 */
export function saveOnboardingTourStatus(status: OnboardingTourStatus): Promise<OnboardingTourStatus> {
  if (!isDesktopApp()) return sampleOnboardingTourBackend.saveOnboardingTourStatus(status)
  return callBackend('set_onboarding_tour_status', { status })
}
