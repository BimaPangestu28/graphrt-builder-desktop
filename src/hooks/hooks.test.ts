import { act, renderHook, waitFor } from '@testing-library/react'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { useAgent } from './useAgent'
import { useAgents } from './useAgents'
import { useAgentVersions } from './useAgentVersions'
import { useAsyncData } from './useAsyncData'
import { useFlowSummary } from './useFlowSummary'
import { useProviderStatuses } from './useProviderStatuses'

describe('useAsyncData', () => {
  it('goes from loading to data', async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.resolve('loaded'), []))
    expect(result.current).toMatchObject({ data: null, error: null, isLoading: true })
    await waitFor(() => expect(result.current).toMatchObject({ data: 'loaded', error: null, isLoading: false }))
  })

  it('keeps the error and turns non-errors into Error', async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.reject('offline'), []))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('offline')
  })

  it('reloads on demand and when dependencies change', async () => {
    const loadData = vi.fn((key: string) => Promise.resolve(`${key}-${loadData.mock.calls.length}`))
    const { result, rerender } = renderHook(({ key }) => useAsyncData(() => loadData(key), [key]), { initialProps: { key: 'a' } })
    await waitFor(() => expect(result.current.data).toBe('a-1'))
    await act(() => result.current.reload())
    expect(result.current.data).toBe('a-2')
    rerender({ key: 'b' })
    await waitFor(() => expect(result.current.data).toBe('b-3'))
  })

  it('ignores a slow answer once a newer request started', async () => {
    let resolveSlowRequest: (value: string) => void = () => {}
    const slowRequest = new Promise<string>((resolve) => {
      resolveSlowRequest = resolve
    })
    const { result, rerender } = renderHook(({ loader }) => useAsyncData(loader, [loader]), {
      initialProps: { loader: () => slowRequest },
    })
    rerender({ loader: () => Promise.resolve('fresh') })
    await waitFor(() => expect(result.current.data).toBe('fresh'))
    await act(async () => resolveSlowRequest('stale'))
    expect(result.current.data).toBe('fresh')
  })
})

describe('data hooks', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleCredentials()
  })
  afterEach(() => vi.restoreAllMocks())

  it('useAgents lists agents', async () => {
    const { result } = renderHook(() => useAgents())
    await waitFor(() => expect(result.current.data).toHaveLength(6))
  })

  it('useAgent loads one agent and reports not_found', async () => {
    const { result, rerender } = renderHook(({ agentId }) => useAgent(agentId), { initialProps: { agentId: 'maps-leads' } })
    await waitFor(() => expect(result.current.data?.name).toBe('Maps leads to WhatsApp'))
    rerender({ agentId: 'missing' })
    await waitFor(() => expect(result.current.error).toMatchObject({ code: 'not_found' }))
    expect(result.current.data).toBeNull()
  })

  it('useFlowSummary and useAgentVersions read the current flow and history', async () => {
    const { result: summaryResult } = renderHook(() => useFlowSummary('maps-leads'))
    const { result: versionsResult } = renderHook(() => useAgentVersions('maps-leads'))
    await waitFor(() => expect(summaryResult.current.data?.steps).toHaveLength(6))
    await waitFor(() => expect(versionsResult.current.data?.[0].version).toBe(7))
  })

  it('useProviderStatuses returns statuses with the default model', async () => {
    const { result } = renderHook(() => useProviderStatuses())
    await waitFor(() => expect(result.current.data?.defaultModel).toEqual({ provider: 'openai', name: 'gpt-4o-mini' }))
    expect(result.current.data?.statuses).toHaveLength(12)
  })

  it('surfaces backend errors', async () => {
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockRejectedValue(new BackendError('database', 'locked'))
    const { result } = renderHook(() => useAgents())
    await waitFor(() => expect(result.current.error).toMatchObject({ code: 'database', message: 'locked' }))
  })
})
