import { BackendError } from '../client'
import type { OnboardingTourStatus } from '../onboardingTour'
import { respondWith } from './sampleResponse'

/**
 * Sample onboarding tour status for the browser preview and tests. Kept in module memory
 * and mirrored to localStorage, so the preview does not reopen the tour on every reload.
 * The desktop app stores it in the app database instead.
 */

const storageKey = 'graphrt.sample.onboardingTourStatus'
const knownStatuses: readonly OnboardingTourStatus[] = ['not_seen', 'completed', 'skipped']

function isOnboardingTourStatus(value: unknown): value is OnboardingTourStatus {
  return knownStatuses.includes(value as OnboardingTourStatus)
}

function readMirroredStatus(): OnboardingTourStatus {
  try {
    const mirroredStatus = window.localStorage.getItem(storageKey)
    return isOnboardingTourStatus(mirroredStatus) ? mirroredStatus : 'not_seen'
  } catch {
    return 'not_seen'
  }
}

function writeMirroredStatus(status: OnboardingTourStatus | null): void {
  try {
    if (status) window.localStorage.setItem(storageKey, status)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Storage blocked: the status lives in memory for this visit only.
  }
}

let storedStatus: OnboardingTourStatus | null = null

function saveSampleStatus(status: OnboardingTourStatus): OnboardingTourStatus {
  if (!isOnboardingTourStatus(status)) throw new BackendError('invalid_input', `unknown tour status ${String(status)}`)
  storedStatus = status
  writeMirroredStatus(status)
  return status
}

export const sampleOnboardingTourBackend = {
  getOnboardingTourStatus: (): Promise<OnboardingTourStatus> => respondWith(() => (storedStatus ??= readMirroredStatus())),
  saveOnboardingTourStatus: (status: OnboardingTourStatus): Promise<OnboardingTourStatus> => respondWith(() => saveSampleStatus(status)),
}

/** Forgets the tour status, as on a fresh install (use in test `beforeEach`). */
export function resetSampleOnboardingTour(): void {
  storedStatus = null
  writeMirroredStatus(null)
}
