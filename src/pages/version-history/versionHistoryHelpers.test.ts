import { renderSampleFlowYaml } from '@/api/sampleBackend/sampleFlowYaml'
import { diffAgentSteps } from './diffAgentSteps'
import { formatSavedAt } from './formatSavedAt'
import { readStepSnapshots } from './readFlowSteps'

const sampleYaml = `version: "1"
name: demo
graph:
  nodes:
    - id: start
      type: start
      title: "Ask for a city"
    - id: each
      type: iteration
      title: For each place
    - id: each_start
      type: iteration-start
      parent: each
    - id: review
      type: human-input
      title: 'Ask me'
      desc: "Approve · or skip"
      actions:
        - id: approve
          title: Approve
    - id: end
      type: end
  edges:
    - { source: start, target: each }
`

describe('readStepSnapshots', () => {
  it('reads node ids, titles and descriptions, skipping helper and nested nodes', () => {
    expect(readStepSnapshots(sampleYaml)).toEqual([
      { id: 'start', name: 'Ask for a city' },
      { id: 'each', name: 'For each place' },
      { id: 'review', name: 'Ask me', setting: 'Approve · or skip' },
    ])
  })

  it('round-trips the sample backend documents', () => {
    const flowYaml = renderSampleFlowYaml('demo', [{ id: 'write', nodeType: 'llm', title: 'Write "hi"', detail: 'max 2 sentences', needsApproval: false, depth: 0 }], [])
    expect(readStepSnapshots(flowYaml)).toEqual([{ id: 'write', name: 'Write "hi"', setting: 'max 2 sentences' }])
  })
})

describe('diffAgentSteps', () => {
  it('shows only the parts of a setting that differ', () => {
    const rows = diffAgentSteps(
      [{ id: 'write', name: 'Write', setting: 'Uses the name · max 2 sentences' }],
      [{ id: 'write', name: 'Write', setting: 'Uses the name · max 4 sentences' }],
    )
    expect(rows).toEqual([{ kind: 'changed', step: expect.objectContaining({ id: 'write' }), fromSetting: 'max 2 sentences', toSetting: 'max 4 sentences' }])
  })

  it('reports a renamed step as changed', () => {
    const rows = diffAgentSteps([{ id: 'write', name: 'Write a short message' }], [{ id: 'write', name: 'Write a message' }])
    expect(rows[0]).toMatchObject({ kind: 'changed', fromSetting: 'Write a short message', toSetting: 'Write a message' })
  })
})

describe('formatSavedAt', () => {
  const now = new Date(2026, 10, 18, 15, 0)

  it('formats recent, today, yesterday and older saves', () => {
    expect(formatSavedAt(new Date(2026, 10, 18, 14, 59, 30).toISOString(), now)).toBe('Just now')
    expect(formatSavedAt(new Date(2026, 10, 18, 13, 1).toISOString(), now)).toBe('Today 13:01')
    expect(formatSavedAt(new Date(2026, 10, 17, 16, 12).toISOString(), now)).toBe('Yesterday 16:12')
    expect(formatSavedAt(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toBe('12 Nov')
    expect(formatSavedAt('not a date', now)).toBe('not a date')
  })
})
