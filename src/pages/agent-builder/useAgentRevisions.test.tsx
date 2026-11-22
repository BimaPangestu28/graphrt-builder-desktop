import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RevisionResult } from '@/api/types'
import { useAgentRevisions } from './useAgentRevisions'

const builderMock = vi.hoisted(() => ({ reviseAgent: vi.fn(), stopAgentRevision: vi.fn() }))
vi.mock('@/api/builder', () => builderMock)

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgentRevisions', () => {
  it('drops a change that finishes after the screen unmounted', async () => {
    const pendingRevision = deferred<RevisionResult>()
    builderMock.reviseAgent.mockReturnValue(pendingRevision.promise)
    const onAgentChanged = vi.fn().mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error')
    const { result, unmount } = renderHook(() => useAgentRevisions({ agentId: 'maps-leads', currentVersion: 1, onAgentChanged }))

    let sendPromise: Promise<void> = Promise.resolve()
    act(() => {
      sendPromise = result.current.sendChangeRequest('add a step')
    })
    expect(result.current.isBusy).toBe(true)
    unmount()

    pendingRevision.resolve({ agent: { currentVersion: 2 }, summary: 'Added', changedStepIds: [], explanation: '' } as unknown as RevisionResult)
    await sendPromise

    expect(onAgentChanged).toHaveBeenCalledWith(1)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
