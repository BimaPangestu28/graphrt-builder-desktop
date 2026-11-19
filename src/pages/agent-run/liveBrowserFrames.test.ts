import { applyLiveViewFrame, isBrowserStep, pickStepLiveViews, type LiveBrowserFrame } from './liveBrowserFrames'
import type { RunStepView } from './runSteps'

function buildStepView(overrides: Partial<RunStepView>): RunStepView {
  return {
    id: 'step',
    label: 'Step',
    depth: 0,
    nodeType: 'llm',
    state: 'pending',
    isModelStep: false,
    startedAt: null,
    durationMs: null,
    retryCount: 0,
    lastRetryError: null,
    streamedText: '',
    outputs: null,
    inputs: null,
    errorMessage: null,
    usage: null,
    detail: null,
    iteration: null,
    itemsDoneCount: null,
    itemDescription: null,
    stepDetail: null,
    ...overrides,
  }
}

const mapsFrame: LiveBrowserFrame = { frameKey: 'node.6d617073.a1', nodeId: 'maps', image: 'data:image/jpeg;base64,bWFwcw==' }

describe('applyLiveViewFrame', () => {
  it('adds a page, replaces its image and moves it last', () => {
    const otherFrame: LiveBrowserFrame = { frameKey: 'page.b2', nodeId: null, image: 'data:other' }
    const withBoth = applyLiveViewFrame(applyLiveViewFrame([], mapsFrame), otherFrame)
    expect(withBoth.map((frame) => frame.frameKey)).toEqual(['node.6d617073.a1', 'page.b2'])

    const updated = applyLiveViewFrame(withBoth, { ...mapsFrame, image: 'data:newer' })
    expect(updated.map((frame) => frame.image)).toEqual(['data:other', 'data:newer'])
  })

  it('removes a page whose image is null and keeps the list when it is unknown', () => {
    const frames = [mapsFrame]
    expect(applyLiveViewFrame(frames, { frameKey: mapsFrame.frameKey, nodeId: 'maps', image: null })).toEqual([])
    expect(applyLiveViewFrame(frames, { frameKey: 'page.unknown', nodeId: null, image: null })).toBe(frames)
  })
})

describe('isBrowserStep', () => {
  it('knows the browser plugins by node kind', () => {
    expect(isBrowserStep(buildStepView({ nodeType: 'google-maps-scraper.search' }))).toBe(true)
    expect(isBrowserStep(buildStepView({ nodeType: 'web-browser.fetch_page' }))).toBe(true)
    expect(isBrowserStep(buildStepView({ nodeType: 'http-request' }))).toBe(false)
    expect(isBrowserStep(buildStepView({ nodeType: null }))).toBe(false)
  })
})

describe('pickStepLiveViews', () => {
  it('shows the page of a running step by its node id', () => {
    const steps = [buildStepView({ id: 'maps', nodeType: 'google-maps-scraper.search', state: 'running' })]
    expect(pickStepLiveViews(steps, [mapsFrame]).get('maps')).toBe(mapsFrame.image)
  })

  it('shows a waiting placeholder for a running browser step without a frame', () => {
    const steps = [buildStepView({ id: 'maps', nodeType: 'google-maps-scraper.search', state: 'running' })]
    const liveViews = pickStepLiveViews(steps, [])
    expect(liveViews.has('maps')).toBe(true)
    expect(liveViews.get('maps')).toBeNull()
  })

  it('shows nothing for finished steps or running steps that use no browser', () => {
    const steps = [
      buildStepView({ id: 'maps', nodeType: 'google-maps-scraper.search', state: 'done' }),
      buildStepView({ id: 'write', nodeType: 'llm', state: 'running' }),
    ]
    expect(pickStepLiveViews(steps, [mapsFrame]).size).toBe(0)
  })

  it('shows a page of an unknown step under the deepest running step', () => {
    const toolFrame: LiveBrowserFrame = { frameKey: 'page.c3', nodeId: null, image: 'data:tool' }
    const steps = [
      buildStepView({ id: 'each', nodeType: 'iteration', state: 'running', depth: 0 }),
      buildStepView({ id: 'agent', nodeType: 'agent', state: 'running', depth: 1 }),
    ]
    const liveViews = pickStepLiveViews(steps, [toolFrame])
    expect(liveViews.get('agent')).toBe('data:tool')
    expect(liveViews.has('each')).toBe(false)
  })
})
