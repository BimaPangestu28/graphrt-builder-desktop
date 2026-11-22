import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSampleDelayScale, waitFor } from '../sampleResponse'

afterEach(() => {
  vi.useRealTimers()
})

describe('sample delay scale', () => {
  it('waits the full delay at scale 1', async () => {
    vi.useFakeTimers()
    setSampleDelayScale(1)
    const onDone = vi.fn()
    void waitFor(500).then(onDone)
    await vi.advanceTimersByTimeAsync(499)
    expect(onDone).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onDone).toHaveBeenCalled()
  })

  it('does not wait at scale 0 (the test default)', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    void waitFor(500).then(onDone)
    await vi.advanceTimersByTimeAsync(0)
    expect(onDone).toHaveBeenCalled()
  })

  it('rejects a negative scale', () => {
    expect(() => setSampleDelayScale(-1)).toThrow(RangeError)
    expect(() => setSampleDelayScale(Number.NaN)).toThrow(RangeError)
  })
})
