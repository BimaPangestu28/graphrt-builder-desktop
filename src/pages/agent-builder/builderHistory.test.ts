import type { BuilderMessage } from '@/api/types'
import { splitBuilderHistory } from './builderHistory'

function createMessage(changes: Partial<BuilderMessage>): BuilderMessage {
  return {
    id: 'message',
    agentId: 'maps-leads',
    role: 'builder',
    text: 'Changed 1 step',
    explanation: null,
    status: 'done',
    versionBefore: 1,
    versionAfter: 2,
    changedStepIds: [],
    createdAt: '2026-11-19T08:00:00Z',
    ...changes,
  }
}

describe('splitBuilderHistory', () => {
  it('takes the build reply out as the opening explanation and keeps the rest in order', () => {
    const buildReply = createMessage({ id: 'build', text: 'Your agent is ready', explanation: 'It searches Maps.', versionBefore: null, versionAfter: 1 })
    const request = createMessage({ id: 'request', role: 'user', text: 'Make it shorter', versionAfter: null })
    const reply = createMessage({ id: 'reply' })
    expect(splitBuilderHistory([buildReply, request, reply])).toEqual({ openingExplanation: 'It searches Maps.', laterMessages: [request, reply] })
  })

  it('has no opening explanation without a build reply or when it was blank', () => {
    const failedReply = createMessage({ status: 'failed', versionBefore: null, versionAfter: null })
    expect(splitBuilderHistory([failedReply])).toEqual({ openingExplanation: null, laterMessages: [failedReply] })
    const silentBuild = createMessage({ versionBefore: null, versionAfter: 1, explanation: null })
    expect(splitBuilderHistory([silentBuild])).toEqual({ openingExplanation: null, laterMessages: [] })
  })
})
