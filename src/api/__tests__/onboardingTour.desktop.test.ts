import type { CommandHandlers } from '@/test/desktopBackend'
import { getOnboardingTourStatus, saveOnboardingTourStatus } from '../onboardingTour'

const fakeBackend = vi.hoisted(() => ({ handlers: {} as CommandHandlers }))
vi.mock('@/api/client', async (importOriginal) => {
  const { createDesktopClient } = await import('@/test/desktopBackend')
  return createDesktopClient(await importOriginal(), fakeBackend)
})

describe('onboarding tour status in the desktop app', () => {
  it('reads and stores the status through the backend settings commands', async () => {
    const savedStatuses: unknown[] = []
    fakeBackend.handlers = {
      get_onboarding_tour_status: () => 'not_seen',
      set_onboarding_tour_status: ({ status }) => {
        savedStatuses.push(status)
        return status
      },
    }
    expect(await getOnboardingTourStatus()).toBe('not_seen')
    expect(await saveOnboardingTourStatus('completed')).toBe('completed')
    expect(savedStatuses).toEqual(['completed'])
    expect(window.localStorage.getItem('graphrt.sample.onboardingTourStatus')).toBeNull()
  })
})
