import { resetSampleAgents } from '../agents'
import { resetSampleLearning, sampleLearningBackend } from '../learning'
import { resetSampleRuns, sampleRunsBackend } from '../runs'

async function finishedRunId(agentId: string): Promise<string> {
  const runs = await sampleRunsBackend.listRuns({ agentId, limit: 50 })
  const finished = runs.find((run) => run.status === 'succeeded' || run.status === 'failed')
  if (!finished) throw new Error(`no finished sample run for ${agentId}`)
  return finished.id
}

describe('sample learning backend', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleRuns()
    resetSampleLearning()
  })

  it('turns a comment into a note that waits, even with automatic learning on', async () => {
    const runId = await finishedRunId('maps-leads')
    await sampleLearningBackend.setAutoLearn('maps-leads', true)
    const outcome = await sampleLearningBackend.recordRunFeedback(runId, { helpful: false, comment: 'Greet people by their first name' })
    expect(outcome.proposed).toHaveLength(1)
    expect(outcome.proposed[0]).toMatchObject({ status: 'proposed', trust: 'derived', risk: 'low', runId })
    const learning = await sampleLearningBackend.getAgentLearning('maps-leads')
    expect(learning.lessons.filter((lesson) => lesson.status === 'approved')).toEqual([])
  })

  it('hides secrets in a comment and proposes nothing without one', async () => {
    const runId = await finishedRunId('maps-leads')
    const outcome = await sampleLearningBackend.recordRunFeedback(runId, { helpful: false, comment: 'Never show sk-abcdefghijkl1234 or write to bob@example.com' })
    expect(outcome.proposed[0].text).toBe('Never show [redacted] or write to [email]')
    expect((await sampleLearningBackend.recordRunFeedback(runId, { helpful: true, comment: null })).proposed).toEqual([])
  })

  it('approves only by decision, and applies an owner note at once', async () => {
    const approved = await sampleLearningBackend.decideLesson('catering-assistant', 'lesson-open-hours', 'approve')
    expect(approved).toMatchObject({ status: 'approved', decidedBy: 'owner' })
    const note = await sampleLearningBackend.addLearningNote('catering-assistant', '  We close at 5  ')
    expect(note).toMatchObject({ text: 'We close at 5', status: 'approved', trust: 'owner' })
    await expect(sampleLearningBackend.addLearningNote('catering-assistant', '<b>x</b>')).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('widens a note only on request and forgets a person', async () => {
    const widened = await sampleLearningBackend.applyLessonToEveryone('catering-assistant', 'lesson-ibu-sari')
    expect(widened.user).toBeNull()
    resetSampleLearning()
    expect(await sampleLearningBackend.forgetLearningPerson('catering-assistant', '+62 812-0000-1234')).toBe(1)
    const learning = await sampleLearningBackend.getAgentLearning('catering-assistant')
    expect(learning.lessons.some((lesson) => lesson.id === 'lesson-ibu-sari')).toBe(false)
  })
})
