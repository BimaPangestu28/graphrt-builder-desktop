import { BackendError } from '../../client'
import { resetSampleAgents, sampleAgentsBackend } from '../agents'
import { sampleVersionsBackend } from '../versions'

describe('sample versions backend', () => {
  beforeEach(() => resetSampleAgents())

  it('compares the current version with an older one step by step', async () => {
    const comparison = await sampleVersionsBackend.compareAgentVersions('maps-leads', 7, 5)
    expect(comparison.from).toMatchObject({ version: 7, error: null })
    expect(comparison.to).toMatchObject({ version: 5, error: null })
    expect(comparison.changes.map((change) => [change.kind, change.stepId, change.position])).toEqual([
      ['unchanged', 'ask_input', 1],
      ['unchanged', 'search_maps', 2],
      ['unchanged', 'for_each_place', 3],
      ['added', 'qualify_lead', 4],
      ['added', 'skip_low_score', 5],
      ['changed', 'write_message', 6],
      ['unchanged', 'approve_message', 7],
      ['changed', 'send_whatsapp', 8],
    ])
    const writeMessage = comparison.changes[5]
    expect(writeMessage.before?.detail).toBe('Uses the place name · max 2 sentences')
    expect(writeMessage.after?.detail).toBe('Uses the place name · max 4 sentences')
  })

  it('lists steps the other version does not have as removed', async () => {
    const comparison = await sampleVersionsBackend.compareAgentVersions('maps-leads', 5, 6)
    const removed = comparison.changes.filter((change) => change.kind === 'removed')
    expect(removed.map((change) => change.stepId)).toEqual(['qualify_lead', 'skip_low_score'])
    expect(removed.every((change) => change.after === null && change.position === null)).toBe(true)
  })

  it('summarizes one saved version', async () => {
    const summary = await sampleVersionsBackend.getVersionFlowSummary('maps-leads', 1)
    expect(summary.steps.map((step) => step.id)).toEqual(['ask_input', 'search_maps', 'for_each_place', 'write_message', 'send_whatsapp'])
  })

  it('rejects unknown agents and versions with not_found', async () => {
    await expect(sampleVersionsBackend.compareAgentVersions('maps-leads', 7, 99)).rejects.toMatchObject({ code: 'not_found' })
    await expect(sampleVersionsBackend.getVersionFlowSummary('nope', 1)).rejects.toBeInstanceOf(BackendError)
  })

  it('restoring steps that are already current adds no version', async () => {
    const restored = await sampleAgentsBackend.restoreAgentVersion('maps-leads', 7)
    expect(restored.currentVersion).toBe(7)
    expect(await sampleAgentsBackend.listAgentVersions('maps-leads')).toHaveLength(7)
  })
})
