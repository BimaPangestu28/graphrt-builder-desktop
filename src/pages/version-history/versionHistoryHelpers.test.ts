import type { FlowStep } from '@/api/types'
import type { StepChange } from '@/api/versionTypes'
import { formatSavedAt } from './formatSavedAt'
import { toStepDiffRows } from './stepDiffRows'

function flowStep(id: string, title: string, detail: string): FlowStep {
  return { id, nodeType: 'llm', title, detail, needsApproval: false, depth: 0 }
}

function changedStep(before: FlowStep, after: FlowStep): StepChange {
  return { stepId: after.id, kind: 'changed', before, after, position: 1 }
}

describe('toStepDiffRows', () => {
  it('shows only the parts of a detail that differ', () => {
    const rows = toStepDiffRows([changedStep(flowStep('write', 'Write', 'Uses the name · max 2 sentences'), flowStep('write', 'Write', 'Uses the name · max 4 sentences'))])
    expect(rows).toEqual([{ kind: 'changed', step: expect.objectContaining({ id: 'write' }), fromSetting: 'max 2 sentences', toSetting: 'max 4 sentences' }])
  })

  it('reports a renamed step as changed', () => {
    const rows = toStepDiffRows([changedStep(flowStep('write', 'Write a short message', ''), flowStep('write', 'Write a message', ''))])
    expect(rows[0]).toMatchObject({ kind: 'changed', fromSetting: 'Write a short message', toSetting: 'Write a message' })
  })

  it('keeps the backend order and numbers unchanged steps by their restored position', () => {
    const find = flowStep('find', 'Find', '')
    const qualify = flowStep('qualify', 'Qualify', '')
    const rows = toStepDiffRows([
      { stepId: 'qualify', kind: 'added', before: null, after: qualify, position: 1 },
      { stepId: 'find', kind: 'unchanged', before: find, after: find, position: 2 },
      { stepId: 'send', kind: 'removed', before: flowStep('send', 'Send', ''), after: null, position: null },
    ])
    expect(rows.map((row) => row.kind)).toEqual(['added', 'unchanged', 'removed'])
    expect(rows[1]).toMatchObject({ position: 2 })
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
