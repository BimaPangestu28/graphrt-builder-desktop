import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { getOnboardingTourStatus, saveOnboardingTourStatus } from '@/api/onboardingTour'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleAppSettings } from '@/api/sampleBackend/appSettings'
import { resetSampleBuilder } from '@/api/sampleBackend/builder'
import { resetSampleConversations } from '@/api/sampleBackend/conversations'
import { resetSampleOnboardingTour } from '@/api/sampleBackend/onboardingTour'
import { resetSampleRuns } from '@/api/sampleBackend/runs'
import { resetSampleTriggers } from '@/api/sampleBackend/triggers'
import { gettingStartedDismissedKey } from '@/pages/home-dashboard/gettingStarted'
import { HomePage } from '@/pages/HomePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { routePaths } from '@/routes'
import { OnboardingTourDialog } from './OnboardingTourDialog'
import { OnboardingTourProvider } from './OnboardingTourProvider'
import { useOnboardingTour } from './onboardingTourContext'
import { tourSteps } from './tourSteps'

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>
}

function OpenTourButton() {
  const onboardingTour = useOnboardingTour()
  return (
    <button type="button" onClick={onboardingTour?.openTour}>
      Open tour
    </button>
  )
}

/** The provider with plain stand-in screens, so only the tour itself is under test. */
function renderWithTour(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnboardingTourProvider>
        <CurrentPath />
        <Routes>
          <Route path={routePaths.home} element={<OpenTourButton />} />
          <Route path={routePaths.newAgent} element={<p>New agent screen</p>} />
          <Route path={routePaths.runs} element={<p>Runs screen</p>} />
          <Route path={routePaths.knowledge} element={<p>Knowledge screen</p>} />
        </Routes>
      </OnboardingTourProvider>
    </MemoryRouter>,
  )
}

function renderTourDialog(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <OnboardingTourDialog onClose={onClose} />
    </MemoryRouter>,
  )
  return onClose
}

const tourDialog = () => screen.getByRole('dialog', { name: tourSteps[0].title })
const currentDot = () => within(screen.getByRole('list', { name: 'Tour steps' })).getByRole('button', { current: 'step' })

beforeEach(() => resetSampleOnboardingTour())

describe('Onboarding tour: when it shows', () => {
  it('opens by itself on the first Home visit, and not again after Skip tour', async () => {
    const firstVisit = renderWithTour(routePaths.home)
    expect(await screen.findByRole('dialog', { name: 'Welcome to graphrt' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(async () => expect(await getOnboardingTourStatus()).toBe('skipped'))
    firstVisit.unmount()

    renderWithTour(routePaths.home)
    await screen.findByRole('button', { name: 'Open tour' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on the New agent screen Welcome leads to, and remembers a finished tour', async () => {
    const firstVisit = renderWithTour(routePaths.newAgent)
    await screen.findByRole('dialog')
    for (let stepIndex = 0; stepIndex < tourSteps.length - 1; stepIndex += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: tourSteps[tourSteps.length - 1].title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(async () => expect(await getOnboardingTourStatus()).toBe('completed'))
    firstVisit.unmount()

    renderWithTour(routePaths.home)
    await screen.findByRole('button', { name: 'Open tour' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not open by itself on other screens', async () => {
    renderWithTour(routePaths.runs)
    await screen.findByText('Runs screen')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes and opens the page when a "Try it" link is followed', async () => {
    await saveOnboardingTourStatus('completed')
    renderWithTour(routePaths.home)
    fireEvent.click(await screen.findByRole('button', { name: 'Open tour' }))
    fireEvent.click(screen.getByRole('button', { name: /Step 7: Knowledge/ }))
    fireEvent.click(screen.getByRole('link', { name: 'Try it: Open Knowledge' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current path')).toHaveTextContent(routePaths.knowledge)
  })
})

describe('Onboarding tour: moving between steps', () => {
  it('goes Next and Back, with the step count and the current dot', () => {
    renderTourDialog()
    expect(screen.getByText(`Step 1 of ${tourSteps.length}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(currentDot()).toHaveAccessibleName(`Step 1: ${tourSteps[0].title}`)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: tourSteps[1].title })).toBeInTheDocument()
    expect(currentDot()).toHaveAccessibleName(`Step 2: ${tourSteps[1].title}`)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: tourSteps[0].title })).toBeInTheDocument()
  })

  it('moves with the arrow keys and closes with Escape as skipped', () => {
    const onClose = renderTourDialog()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: tourSteps[2].title })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { name: tourSteps[1].title })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { name: tourSteps[0].title })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('skipped')
  })

  it('jumps to a step from its dot, and finishes as completed', () => {
    const onClose = renderTourDialog()
    fireEvent.click(screen.getByRole('button', { name: `Step ${tourSteps.length}: ${tourSteps[tourSteps.length - 1].title}` }))
    expect(screen.queryByRole('button', { name: 'Skip tour' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledWith('completed')
  })

  it('labels the dialog by its title and describes it with the explanation', () => {
    renderTourDialog()
    expect(tourDialog()).toHaveAccessibleDescription(tourSteps[0].explanation)
  })
})

describe('Onboarding tour: focus', () => {
  it('focuses Next on open, keeps Tab inside and returns focus to the opener on close', async () => {
    await saveOnboardingTourStatus('skipped')
    renderWithTour(routePaths.home)
    const openButton = await screen.findByRole('button', { name: 'Open tour' })
    openButton.focus()
    fireEvent.click(openButton)
    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close tour' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(nextButton).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Close tour' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton).toHaveFocus()
  })
})

describe('Onboarding tour: reopening', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleBuilder()
    resetSampleRuns()
    resetSampleConversations()
    resetSampleTriggers()
    resetSampleAppSettings()
    window.localStorage.removeItem(gettingStartedDismissedKey)
    await saveOnboardingTourStatus('completed')
  })

  function renderScreen(path: string, screenElement: JSX.Element) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <OnboardingTourProvider>
          <Routes>
            <Route path={path} element={screenElement} />
          </Routes>
        </OnboardingTourProvider>
      </MemoryRouter>,
    )
  }

  it('opens from "Take the tour" in the Getting started card on Home', async () => {
    renderScreen(routePaths.home, <HomePage />)
    const checklist = await screen.findByRole('region', { name: /Getting started/ })
    fireEvent.click(within(checklist).getByRole('button', { name: 'Take the tour' }))
    expect(screen.getByRole('dialog', { name: tourSteps[0].title })).toBeInTheDocument()
  })

  it('opens from "Show the tour again" in Settings, About', async () => {
    renderScreen(routePaths.settings, <SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show the tour again' }))
    expect(screen.getByRole('dialog', { name: tourSteps[0].title })).toBeInTheDocument()
  })
})
