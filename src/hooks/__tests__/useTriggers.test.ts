import { act, renderHook, waitFor } from '@testing-library/react'
import { BackendError } from '@/api/client'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { resetSampleTriggers, sampleTriggersBackend } from '@/api/sampleBackend/triggers'
import { useLoadedData } from '../useRunData'
import { useRuns } from '../useRuns'
import { useSchedulePreview, useTriggers } from '../useTriggers'

describe('useLoadedData', () => {
  it('ignores the result of a load that is no longer current', async () => {
    let resolveSlowLoad: (value: string) => void = () => {}
    const slowLoad = new Promise<string>((resolve) => {
      resolveSlowLoad = resolve
    })
    const { result, rerender } = renderHook(({ key }) => useLoadedData(() => (key === 'slow' ? slowLoad : Promise.resolve('fast')), [key]), {
      initialProps: { key: 'slow' },
    })
    rerender({ key: 'fast' })
    await waitFor(() => expect(result.current.data).toBe('fast'))
    await act(async () => resolveSlowLoad('slow'))
    expect(result.current.data).toBe('fast')
  })
})

describe('useRuns', () => {
  beforeEach(() => {
    resetSampleRuns()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the filter to listRuns', async () => {
    const listRunsSpy = vi.spyOn(sampleRunsBackend, 'listRuns')
    const { result } = renderHook(() => useRuns({ status: 'failed' }))
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(listRunsSpy).toHaveBeenCalledWith({ agentId: undefined, status: 'failed', limit: undefined })
  })
})

describe('useTriggers', () => {
  beforeEach(() => {
    resetSampleTriggers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists triggers and switches one off', async () => {
    const { result } = renderHook(() => useTriggers())
    await waitFor(() => expect(result.current.triggers).toHaveLength(3))
    await act(() => result.current.setEnabled('maps-leads', false))
    expect(result.current.triggers[0]).toMatchObject({ enabled: false, nextFireAt: null })
  })

  it('reverts the switch when the backend refuses', async () => {
    vi.spyOn(sampleTriggersBackend, 'setTriggerEnabled').mockRejectedValue(new BackendError('database', 'Locked'))
    const { result } = renderHook(() => useTriggers())
    await waitFor(() => expect(result.current.triggers).toHaveLength(3))
    await act(() => result.current.setEnabled('maps-leads', false))
    expect(result.current.triggers[0].enabled).toBe(true)
    expect(result.current.toggleError?.message).toBe('Locked')
  })
})

describe('useSchedulePreview', () => {
  it('previews a schedule and skips null expressions', async () => {
    const previewSpy = vi.spyOn(sampleTriggersBackend, 'previewSchedule')
    const { result, rerender } = renderHook(({ cron }) => useSchedulePreview(cron, 'Asia/Jakarta', 2), {
      initialProps: { cron: '0 0 9 * * *' as string | null },
    })
    await waitFor(() => expect(result.current.fireTimes).toHaveLength(2))
    rerender({ cron: null })
    expect(result.current.fireTimes).toEqual([])
    expect(previewSpy).toHaveBeenCalledTimes(1)
  })

  it('reports preview errors', async () => {
    const { result } = renderHook(() => useSchedulePreview('bad', 'Asia/Jakarta'))
    await waitFor(() => expect(result.current.error?.message).toMatch('Could not read the schedule'))
  })
})
