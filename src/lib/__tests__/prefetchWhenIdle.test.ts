import { prefetchWhenIdle } from '../prefetchWhenIdle'

describe('prefetchWhenIdle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads nothing before the window is idle, then each chunk in its own slot', async () => {
    const firstLoader = vi.fn(() => Promise.resolve('first'))
    const secondLoader = vi.fn(() => Promise.resolve('second'))

    prefetchWhenIdle([firstLoader, secondLoader])
    expect(firstLoader).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(firstLoader).toHaveBeenCalledTimes(1)
    expect(secondLoader).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(secondLoader).toHaveBeenCalledTimes(1)
  })

  it('keeps going after a chunk fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failingLoader = vi.fn(() => Promise.reject(new Error('missing chunk')))
    const nextLoader = vi.fn(() => Promise.resolve('next'))

    prefetchWhenIdle([failingLoader, nextLoader])
    await vi.advanceTimersByTimeAsync(400)

    expect(nextLoader).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('prefetching a screen failed', expect.any(Error))
  })

  it('stops loading when cancelled', async () => {
    const firstLoader = vi.fn(() => Promise.resolve('first'))
    const secondLoader = vi.fn(() => Promise.resolve('second'))

    const cancelPrefetch = prefetchWhenIdle([firstLoader, secondLoader])
    await vi.advanceTimersByTimeAsync(200)
    cancelPrefetch()
    await vi.advanceTimersByTimeAsync(1000)

    expect(firstLoader).toHaveBeenCalledTimes(1)
    expect(secondLoader).not.toHaveBeenCalled()
  })
})
