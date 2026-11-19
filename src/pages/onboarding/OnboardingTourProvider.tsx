import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { getOnboardingTourStatus, saveOnboardingTourStatus } from '@/api/onboardingTour'
import { routePaths } from '@/routes'
import { OnboardingTourDialog, type TourOutcome } from './OnboardingTourDialog'
import { OnboardingTourContext, type OnboardingTourControls } from './onboardingTourContext'

/**
 * Screens where the tour opens by itself the first time: New agent, where Welcome leads
 * after the first-launch model setup, and Home for installs that finished Welcome earlier.
 */
const autoShowPaths: readonly string[] = [routePaths.home, routePaths.newAgent]

/**
 * Opens the tour once when the user reaches an auto-show screen and has never completed
 * or skipped it. The stored status is checked at most once per app session.
 *
 * @param openTour - Called when the tour should open (() => void)
 */
function useAutoShowTour(openTour: () => void): void {
  const { pathname } = useLocation()
  const hasCheckedStatusRef = useRef(false)

  useEffect(() => {
    if (hasCheckedStatusRef.current || !autoShowPaths.includes(pathname)) return
    hasCheckedStatusRef.current = true
    getOnboardingTourStatus()
      .then((status) => {
        if (status === 'not_seen') openTour()
      })
      .catch((statusError: unknown) => console.warn('Could not read the onboarding tour status; not showing it', statusError))
  }, [pathname, openTour])
}

/**
 * Holds the onboarding tour for the whole app: shows it once on its own (see
 * `useAutoShowTour`), lets any screen reopen it through `useOnboardingTour`, and saves how
 * it ended (completed or skipped) so it does not open by itself again. Render inside the router.
 */
export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const [isTourOpen, setIsTourOpen] = useState(false)
  const openTour = useCallback(() => setIsTourOpen(true), [])
  useAutoShowTour(openTour)

  const closeTour = useCallback((outcome: TourOutcome) => {
    setIsTourOpen(false)
    saveOnboardingTourStatus(outcome).catch((saveError: unknown) => console.warn(`Could not save the onboarding tour as ${outcome}`, saveError))
  }, [])

  const tourControls = useMemo<OnboardingTourControls>(() => ({ openTour }), [openTour])
  return (
    <OnboardingTourContext.Provider value={tourControls}>
      {children}
      {isTourOpen && <OnboardingTourDialog onClose={closeTour} />}
    </OnboardingTourContext.Provider>
  )
}
