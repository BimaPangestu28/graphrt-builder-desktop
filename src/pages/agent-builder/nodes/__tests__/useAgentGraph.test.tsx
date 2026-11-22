import { act, renderHook, waitFor } from '@testing-library/react'
import { resetSampleAgentGraphs, sampleAgentGraphBackend, setSampleBuilderBusy } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { listStoredBuilderMessages, readCurrentSteps, readStoredAgent, saveNewVersion } from '@/api/sampleBackend/sampleAgentStore'
import { useAgentGraph } from '../useAgentGraph'

const agentId = 'maps-leads'

async function renderLoadedHook(options: { onSaved?: () => void } = {}) {
  const hook = renderHook(({ currentVersion }) => useAgentGraph({ agentId, currentVersion, onSaved: options.onSaved }), {
    initialProps: { currentVersion: readStoredAgent(agentId).currentVersion as number | null },
  })
  await waitFor(() => expect(hook.result.current.graph).not.toBeNull())
  return hook
}

describe('useAgentGraph', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the current graph and its saved positions', async () => {
    await sampleAgentGraphBackend.saveNodeLayout(agentId, 7, [{ nodeId: 'search_maps', x: 10, y: 20 }], { x: 0, y: 0, zoom: 0.9 })
    const { result } = await renderLoadedHook()

    expect(result.current.graph?.version).toBe(7)
    expect(result.current.graph?.nodes.find((node) => node.id === 'approve_message')?.ports.outputs.map((port) => port.id)).toEqual(['send', 'skip'])
    expect(result.current.positions.search_maps).toMatchObject({ x: 10, y: 20 })
    expect(result.current.viewport).toEqual({ x: 0, y: 0, zoom: 0.9 })
    expect(result.current.isDirty).toBe(false)
    expect(result.current.status).toBe('idle')
  })

  it('tracks edits with undo and redo', async () => {
    const { result } = await renderLoadedHook()

    act(() => result.current.updateNode('write_message', { title: 'Write a promotion' }, 'renamed Write a short message'))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.graph?.nodes.find((node) => node.id === 'write_message')?.displayTitle).toBe('Write a promotion')
    expect(result.current.pendingDescriptions).toEqual(['renamed Write a short message'])

    act(() => result.current.undo())
    expect(result.current.isDirty).toBe(false)
    expect(result.current.canRedo).toBe(true)
    expect(result.current.pendingDescriptions).toEqual([])

    act(() => result.current.redo())
    expect(result.current.graph?.nodes.find((node) => node.id === 'write_message')?.title).toBe('Write a promotion')
    expect(result.current.canUndo).toBe(true)
  })

  it('applies two edits made in the same tick, each as its own undo step', async () => {
    const { result } = await renderLoadedHook()
    const { updateNode } = result.current

    act(() => {
      updateNode('write_message', { title: 'Write a promotion' }, 'renamed Write a short message')
      updateNode('search_maps', { title: 'Find cafes' }, 'renamed Search Maps')
    })
    const titleOf = (nodeId: string) => result.current.graph?.nodes.find((node) => node.id === nodeId)?.title
    expect(titleOf('write_message')).toBe('Write a promotion')
    expect(titleOf('search_maps')).toBe('Find cafes')
    expect(result.current.pendingDescriptions).toEqual(['renamed Write a short message', 'renamed Search Maps'])

    act(() => result.current.undo())
    expect(titleOf('search_maps')).not.toBe('Find cafes')
    expect(titleOf('write_message')).toBe('Write a promotion')
    expect(result.current.pendingDescriptions).toEqual(['renamed Write a short message'])
  })

  it('undoes and redoes several edits in order, and a new edit clears redo', async () => {
    const { result } = await renderLoadedHook()
    const titleOf = () => result.current.graph?.nodes.find((node) => node.id === 'write_message')?.title
    const originalTitle = titleOf()
    for (const title of ['First', 'Second', 'Third']) act(() => result.current.updateNode('write_message', { title }, `renamed to ${title}`))

    act(() => {
      result.current.undo()
      result.current.undo()
    })
    expect(titleOf()).toBe('First')
    act(() => result.current.redo())
    expect(titleOf()).toBe('Second')
    expect(result.current.pendingDescriptions).toEqual(['renamed to First', 'renamed to Second'])

    act(() => result.current.updateNode('write_message', { title: 'Other' }, 'renamed to Other'))
    expect(result.current.canRedo).toBe(false)
    act(() => {
      for (let step = 0; step < 5; step += 1) result.current.undo()
    })
    expect(titleOf()).toBe(originalTitle)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.isDirty).toBe(false)
  })

  it('keeps applyEdit, undo and redo stable across edits', async () => {
    const { result } = await renderLoadedHook()
    const { applyEdit, undo, redo } = result.current
    act(() => result.current.updateNode('write_message', { title: 'Changed' }))
    expect(result.current.applyEdit).toBe(applyEdit)
    expect(result.current.undo).toBe(undo)
    expect(result.current.redo).toBe(redo)
  })

  it('derives ports locally: the error exit appears with Go to the error path', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.updateNode('send_whatsapp', { onError: { strategy: 'fail-branch', values: {} } }))
    const send = result.current.graph?.nodes.find((node) => node.id === 'send_whatsapp')
    expect(send?.ports.outputs.map((port) => port.id)).toEqual(['source', 'fail-branch'])
  })

  it('saves edits as a new version with the edit descriptions and the positions', async () => {
    const onSaved = vi.fn()
    const saveSpy = vi.spyOn(sampleAgentGraphBackend, 'saveAgentGraph')
    const { result } = await renderLoadedHook({ onSaved })
    act(() => result.current.moveNodes([{ nodeId: 'write_message', x: 300, y: 40 }]))
    act(() => result.current.updateNode('send_whatsapp', { retry: { maxRetries: 2, intervalMs: 2000, backoff: 2 } }, 'set Retry 2× on Send WhatsApp'))

    let saveResult: Awaited<ReturnType<typeof result.current.save>> = null
    await act(async () => {
      saveResult = await result.current.save()
    })

    expect(saveSpy).toHaveBeenCalledWith(agentId, 7, expect.objectContaining({ description: 'set Retry 2× on Send WhatsApp', layout: [{ nodeId: 'write_message', x: 300, y: 40 }] }))
    expect(saveResult).toMatchObject({ saved: true, versionBefore: 7, versionAfter: 8, summary: 'Edited in Nodes: set Retry 2× on Send WhatsApp' })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saved')
    expect(result.current.isDirty).toBe(false)
    expect(result.current.canUndo).toBe(false)
    expect(readStoredAgent(agentId).currentVersion).toBe(8)
    expect(listStoredBuilderMessages(agentId).at(-1)).toMatchObject({ text: 'Edited in Nodes: set Retry 2× on Send WhatsApp', versionBefore: 7, versionAfter: 8 })
    expect((await sampleAgentGraphBackend.getNodeLayout(agentId, 8)).nodes).toEqual([{ nodeId: 'write_message', x: 300, y: 40 }])
  })

  it('does not call the backend without edits', async () => {
    const saveSpy = vi.spyOn(sampleAgentGraphBackend, 'saveAgentGraph')
    const { result } = await renderLoadedHook()
    await act(async () => {
      expect(await result.current.save()).toBeNull()
    })
    expect(saveSpy).not.toHaveBeenCalled()
  })

  /** A builder change that renames one step, like a chat revision landing meanwhile. */
  function saveBuilderRename(stepId: string, title: string) {
    saveNewVersion(agentId, readCurrentSteps(agentId).map((step) => (step.id === stepId ? { ...step, title } : step)), `Renamed ${stepId}`)
  }

  it('reports a conflict when the builder changed the same step, and keeps the builder’s version on request', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.updateNode('write_message', { title: 'Mine' }))
    saveBuilderRename('write_message', 'The builder’s title')

    await act(async () => {
      await result.current.save()
    })
    expect(result.current.status).toBe('conflict')
    expect(result.current.conflict).toMatchObject({ latestVersion: 8, nodes: [{ nodeId: 'write_message', title: 'Write a short message' }] })

    await act(async () => result.current.resolveConflict('keep-theirs'))
    expect(result.current.graph?.version).toBe(8)
    expect(result.current.graph?.nodes.find((node) => node.id === 'write_message')?.title).toBe('The builder’s title')
    expect(result.current.isDirty).toBe(false)
    expect(result.current.status).toBe('idle')
  })

  it('keeps mine by saving the edit over the latest version', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.updateNode('write_message', { title: 'Mine' }))
    saveBuilderRename('write_message', 'The builder’s title')
    await act(async () => {
      await result.current.save()
    })

    await act(async () => result.current.resolveNodeConflict('write_message', 'keep-mine'))

    expect(result.current.status).toBe('saved')
    expect(result.current.lastSave).toMatchObject({ versionBefore: 8, versionAfter: 9 })
    expect(result.current.graph?.nodes.find((node) => node.id === 'write_message')?.title).toBe('Mine')
  })

  it('re-applies edits of other steps onto the builder’s version without asking', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.updateNode('write_message', { title: 'Mine' }))
    saveBuilderRename('search_maps', 'Search the map')
    await act(async () => {
      await result.current.save()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.conflict).toBeNull()
    expect(result.current.lastMerge).toEqual({ latestVersion: 8, reappliedNodeIds: ['write_message'] })
    expect(result.current.savedGraph?.version).toBe(8)
    expect(result.current.isDirty).toBe(true)
    await act(async () => {
      await result.current.save()
    })
    const saved = result.current.graph
    expect(result.current.lastSave).toMatchObject({ versionBefore: 8, versionAfter: 9 })
    expect(saved?.nodes.find((node) => node.id === 'write_message')?.title).toBe('Mine')
    expect(saved?.nodes.find((node) => node.id === 'search_maps')?.title).toBe('Search the map')
  })

  it('turns a version change from the chat into a reload when clean, a merge or a conflict when dirty', async () => {
    const hook = await renderLoadedHook()
    saveNewVersion(agentId, readCurrentSteps(agentId), 'Chat change')
    hook.rerender({ currentVersion: 8 })
    await waitFor(() => expect(hook.result.current.graph?.version).toBe(8))

    act(() => hook.result.current.updateNode('write_message', { title: 'Mine' }))
    saveBuilderRename('search_maps', 'Search the map')
    hook.rerender({ currentVersion: 9 })
    await waitFor(() => expect(hook.result.current.savedGraph?.version).toBe(9))
    expect(hook.result.current.status).toBe('idle')
    expect(hook.result.current.graph?.nodes.find((node) => node.id === 'write_message')?.title).toBe('Mine')

    saveBuilderRename('write_message', 'The builder’s title')
    hook.rerender({ currentVersion: 10 })
    await waitFor(() => expect(hook.result.current.status).toBe('conflict'))
    expect(hook.result.current.conflict?.nodes.map((node) => node.nodeId)).toEqual(['write_message'])
  })

  it('waits while the builder is changing the agent', async () => {
    const saveSpy = vi.spyOn(sampleAgentGraphBackend, 'saveAgentGraph')
    const { result } = await renderLoadedHook()
    act(() => setSampleBuilderBusy(agentId, true))
    await waitFor(() => expect(result.current.builderBusy).toBe(true))
    act(() => result.current.updateNode('write_message', { title: 'Mine' }))

    await act(async () => {
      expect(await result.current.save()).toBeNull()
    })
    expect(result.current.status).toBe('builder-busy')
    expect(saveSpy).not.toHaveBeenCalled()

    act(() => setSampleBuilderBusy(agentId, false))
    await waitFor(() => expect(result.current.builderBusy).toBe(false))
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.status).toBe('saved')
  })

  it('shows the problems of a refused save and keeps the edit', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.addEdge({ source: 'write_message', target: 'ghost' }))
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.status).toBe('invalid')
    expect(result.current.saveProblems[0]).toMatchObject({ severity: 'error', code: 'compile' })
    expect(result.current.isDirty).toBe(true)
  })

  it('saves moved positions for the saved version without adding one', async () => {
    const { result } = await renderLoadedHook()
    act(() => result.current.moveNodes([{ nodeId: 'end', x: 900, y: 0 }]))
    expect(result.current.isLayoutDirty).toBe(true)
    await act(async () => result.current.saveLayout())
    expect(result.current.isLayoutDirty).toBe(false)
    expect((await sampleAgentGraphBackend.getNodeLayout(agentId, 7)).nodes).toEqual([{ nodeId: 'end', x: 900, y: 0 }])
    expect(readStoredAgent(agentId).currentVersion).toBe(7)
  })
})
