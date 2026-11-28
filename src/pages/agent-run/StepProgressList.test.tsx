import { act, render, screen } from '@testing-library/react'
import type { LiveViewFrame } from '@/api/liveView'
import type { RunStepView } from './runSteps'
import { StepProgressList } from './StepProgressList'

const liveView = vi.hoisted(() => ({
  listeners: [] as Array<(frame: LiveViewFrame) => void>,
  unsubscribeCount: 0,
}))

vi.mock('@/api/liveView', () => ({
  subscribeToLiveView: async (onFrame: (frame: LiveViewFrame) => void) => {
    liveView.listeners.push(onFrame)
    return () => {
      liveView.unsubscribeCount += 1
      liveView.listeners = liveView.listeners.filter((listener) => listener !== onFrame)
    }
  },
}))

function buildMapsStep(state: RunStepView['state']): RunStepView {
  return {
    id: 'find_places',
    label: 'Find places on Google Maps',
    depth: 0,
    nodeType: 'google-maps-scraper.search',
    state,
    isModelStep: false,
    startedAt: state === 'running' ? '2026-11-19T08:00:00Z' : null,
    durationMs: state === 'done' ? 4200 : null,
    retryCount: 0,
    lastRetryError: null,
    streamedText: '',
    outputs: null,
    inputs: null,
    errorMessage: null,
    errorType: null,
    chosenAction: null,
    usage: null,
    detail: null,
    iteration: null,
    itemsDoneCount: null,
    itemDescription: null,
    stepDetail: null,
    learnedNoteCount: 0,
    unavailableSkillTools: [],
    abilityNotes: [],
  }
}

async function sendFrame(frame: LiveViewFrame) {
  await act(async () => {
    for (const listener of liveView.listeners) listener(frame)
  })
}

const mapsFrameKey = 'node.66696e645f706c61636573.a1b2c3'

beforeEach(() => {
  liveView.listeners = []
  liveView.unsubscribeCount = 0
})

describe('StepProgressList live browser view', () => {
  it('waits for the browser, then shows each new frame under the running step', async () => {
    render(<StepProgressList steps={[buildMapsStep('running')]} now={Date.parse('2026-11-19T08:00:05Z')} />)
    const view = await screen.findByRole('figure', { name: 'Live view of the browser' })
    expect(view).toHaveTextContent('Waiting for the browser…')

    await sendFrame({ frameKey: mapsFrameKey, nodeId: 'find_places', image: 'data:image/jpeg;base64,b25l' })
    expect(screen.getByRole('img', { name: 'What the browser shows right now' })).toHaveAttribute('src', 'data:image/jpeg;base64,b25l')

    await sendFrame({ frameKey: mapsFrameKey, nodeId: 'find_places', image: 'data:image/jpeg;base64,dHdv' })
    expect(screen.getByRole('img', { name: 'What the browser shows right now' })).toHaveAttribute('src', 'data:image/jpeg;base64,dHdv')

    await sendFrame({ frameKey: mapsFrameKey, nodeId: 'find_places', image: null })
    expect(screen.queryByRole('img', { name: 'What the browser shows right now' })).not.toBeInTheDocument()
  })

  it('ignores frames of other steps', async () => {
    render(<StepProgressList steps={[buildMapsStep('running')]} />)
    await screen.findByRole('figure', { name: 'Live view of the browser' })
    await sendFrame({ frameKey: 'node.6f74686572.d4', nodeId: 'other', image: 'data:image/jpeg;base64,b3RoZXI=' })
    expect(screen.queryByRole('img', { name: 'What the browser shows right now' })).not.toBeInTheDocument()
  })

  it('removes the view and stops listening when the step finishes', async () => {
    const { rerender } = render(<StepProgressList steps={[buildMapsStep('running')]} />)
    await screen.findByRole('figure', { name: 'Live view of the browser' })
    await sendFrame({ frameKey: mapsFrameKey, nodeId: 'find_places', image: 'data:image/jpeg;base64,b25l' })

    rerender(<StepProgressList steps={[buildMapsStep('done')]} />)
    expect(screen.queryByRole('figure', { name: 'Live view of the browser' })).not.toBeInTheDocument()
    expect(liveView.unsubscribeCount).toBe(1)
  })

  it('does not listen when no step is running', () => {
    render(<StepProgressList steps={[buildMapsStep('pending')]} />)
    expect(liveView.listeners).toHaveLength(0)
    expect(screen.queryByRole('figure', { name: 'Live view of the browser' })).not.toBeInTheDocument()
  })
})

describe('StepProgressList status markers', () => {
  it('spins a ring on the running step and keeps "Running" for screen readers', () => {
    render(<StepProgressList steps={[buildMapsStep('running')]} />)
    const stepButton = screen.getByRole('button', { name: /Find places on Google Maps\s*, Running/ })
    const spinner = stepButton.querySelector('[data-spinner]')
    expect(spinner).toHaveClass('motion-safe:animate-spin')
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
  })

  it('does not spin for a step that is not running', () => {
    render(<StepProgressList steps={[buildMapsStep('pending'), { ...buildMapsStep('done'), id: 'other', label: 'Other' }]} />)
    expect(document.querySelector('[data-spinner]')).toBeNull()
  })
})
