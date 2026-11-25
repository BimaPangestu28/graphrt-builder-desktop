import { act, renderHook } from '@testing-library/react'
import { nextRevealCount, shownRevealCount, useIncrementalReveal } from './useIncrementalReveal'

type ObserverCallback = (entries: Array<Pick<IntersectionObserverEntry, 'isIntersecting'>>) => void

/** A stand-in IntersectionObserver (jsdom has none) that tests trigger by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly options: IntersectionObserverInit | undefined
  observed: Element[] = []
  disconnected = false
  private readonly callback: ObserverCallback

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }

  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }])
  }

  static latest(): FakeIntersectionObserver {
    const live = FakeIntersectionObserver.instances.filter((instance) => !instance.disconnected)
    const latest = live[live.length - 1]
    if (!latest) throw new Error('no live IntersectionObserver')
    return latest
  }
}

describe('nextRevealCount', () => {
  it('adds a page and stops at the total', () => {
    expect(nextRevealCount(24, 100, 24)).toBe(48)
    expect(nextRevealCount(96, 100, 24)).toBe(100)
    expect(nextRevealCount(100, 100, 24)).toBe(100)
    expect(nextRevealCount(0, 0, 24)).toBe(0)
  })
})

describe('shownRevealCount', () => {
  it('keeps what was revealed for the same filters and starts over for new ones', () => {
    expect(shownRevealCount({ resetKey: 'q=mail', count: 72 }, 'q=mail', 100, 24)).toBe(72)
    expect(shownRevealCount({ resetKey: 'q=mail', count: 72 }, 'q=maps', 100, 24)).toBe(24)
  })

  it('never shows more than there are', () => {
    expect(shownRevealCount({ resetKey: '', count: 72 }, '', 30, 24)).toBe(30)
    expect(shownRevealCount({ resetKey: 'a', count: 72 }, 'b', 5, 24)).toBe(5)
  })
})

describe('useIncrementalReveal', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })
  afterEach(() => vi.unstubAllGlobals())

  function renderReveal(totalCount: number, resetKey = '') {
    const hook = renderHook(({ total, key }) => useIncrementalReveal(total, key, 10), { initialProps: { total: totalCount, key: resetKey } })
    act(() => hook.result.current.sentinelRef(document.createElement('div')))
    return hook
  }

  it('shows the first page, then one more each time the sentinel comes into reach', () => {
    const { result } = renderReveal(25)
    expect(result.current).toMatchObject({ visibleCount: 10, hasMore: true })
    expect(FakeIntersectionObserver.latest().options?.rootMargin).toBe('0px 0px 600px 0px')
    act(() => FakeIntersectionObserver.latest().trigger(false))
    expect(result.current.visibleCount).toBe(10)
    act(() => FakeIntersectionObserver.latest().trigger(true))
    expect(result.current.visibleCount).toBe(20)
    act(() => FakeIntersectionObserver.latest().trigger(true))
    expect(result.current).toMatchObject({ visibleCount: 25, hasMore: false })
  })

  it('stops observing once everything is shown', () => {
    const { result } = renderReveal(12)
    act(() => FakeIntersectionObserver.latest().trigger(true))
    expect(result.current.hasMore).toBe(false)
    expect(FakeIntersectionObserver.instances.every((instance) => instance.disconnected)).toBe(true)
  })

  it('goes back to the first page when the filters change', () => {
    const { result, rerender } = renderReveal(50, 'tab=all')
    act(() => result.current.revealMore())
    act(() => result.current.revealMore())
    expect(result.current.visibleCount).toBe(30)
    rerender({ total: 40, key: 'q=mail' })
    expect(result.current).toMatchObject({ visibleCount: 10, hasMore: true })
    act(() => result.current.revealMore())
    expect(result.current.visibleCount).toBe(20)
  })

  it('shows a short list whole, with nothing to observe', () => {
    const { result } = renderReveal(4)
    expect(result.current).toMatchObject({ visibleCount: 4, hasMore: false })
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
  })

  it('still pages through revealMore where IntersectionObserver is missing', () => {
    vi.unstubAllGlobals()
    const { result } = renderReveal(15)
    act(() => result.current.revealMore())
    expect(result.current).toMatchObject({ visibleCount: 15, hasMore: false })
  })
})

describe('useIncrementalReveal filter round trips', () => {
  it('does not bring back an old count when the filters return to earlier ones', () => {
    const { result, rerender } = renderHook(({ key }) => useIncrementalReveal(50, key, 10), { initialProps: { key: 'tab=all' } })
    act(() => result.current.revealMore())
    expect(result.current.visibleCount).toBe(20)
    rerender({ key: 'category=messaging' })
    rerender({ key: 'tab=all' })
    expect(result.current.visibleCount).toBe(10)
  })
})
