import { BackendError } from '../../client'
import type { OnboardingTourStatus } from '../../onboardingTour'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '../appSettings'
import { resetSampleOnboardingTour, sampleOnboardingTourBackend } from '../onboardingTour'

describe('sample onboarding tour backend', () => {
  beforeEach(() => {
    resetSampleOnboardingTour()
    resetSampleAppSettings()
  })

  it('starts as not seen and keeps the saved status', async () => {
    expect(await sampleOnboardingTourBackend.getOnboardingTourStatus()).toBe('not_seen')
    expect(await sampleOnboardingTourBackend.saveOnboardingTourStatus('skipped')).toBe('skipped')
    expect(await sampleOnboardingTourBackend.getOnboardingTourStatus()).toBe('skipped')
  })

  it('survives a reload of the preview through localStorage', async () => {
    await sampleOnboardingTourBackend.saveOnboardingTourStatus('completed')
    expect(window.localStorage.getItem('graphrt.sample.onboardingTourStatus')).toBe('completed')
  })

  it('rejects an unknown status with invalid_input', async () => {
    const savePromise = sampleOnboardingTourBackend.saveOnboardingTourStatus('halfway' as OnboardingTourStatus)
    await expect(savePromise).rejects.toBeInstanceOf(BackendError)
    await expect(savePromise).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('forgets the status when all data is deleted, like the desktop app', async () => {
    await sampleOnboardingTourBackend.saveOnboardingTourStatus('completed')
    await sampleAppSettingsBackend.deleteAllData(false)
    expect(await sampleOnboardingTourBackend.getOnboardingTourStatus()).toBe('not_seen')
  })
})
