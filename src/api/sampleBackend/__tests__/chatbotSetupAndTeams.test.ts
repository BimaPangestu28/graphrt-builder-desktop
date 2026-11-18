import { BackendError } from '../../client'
import { resetSampleChatbotSetups, sampleChatbotSetupBackend } from '../chatbotSetup'
import { resetSampleKnowledge } from '../knowledge'
import { resetSampleTeams, sampleTeamsBackend } from '../teams'

describe('sample chatbot setup backend', () => {
  beforeEach(() => {
    resetSampleChatbotSetups()
    resetSampleKnowledge()
  })

  it('seeds the catering assistant and reports other chatbots as never saved', async () => {
    const catering = await sampleChatbotSetupBackend.getChatbotSetup('catering-assistant')
    expect(catering.isSaved).toBe(true)
    expect(catering.settings.knowledgeBaseIds).toEqual(['menu-and-prices'])
    expect(catering.channels.map((channel) => [channel.id, channel.connected])).toEqual([
      ['whatsapp', true],
      ['telegram', false],
    ])
    const other = await sampleChatbotSetupBackend.getChatbotSetup('other-bot')
    expect(other.isSaved).toBe(false)
    expect(other.settings.handoffRules).toEqual({ asksForPerson: true, notInKnowledge: true, orderReady: true, soundsUpset: true })
  })

  it('attaches known knowledge once, detaches it, and rejects unknown knowledge', async () => {
    await sampleChatbotSetupBackend.attachChatbotKnowledge('catering-assistant', 'past-orders')
    const twice = await sampleChatbotSetupBackend.attachChatbotKnowledge('catering-assistant', 'past-orders')
    expect(twice.settings.knowledgeBaseIds).toEqual(['menu-and-prices', 'past-orders'])
    const detached = await sampleChatbotSetupBackend.detachChatbotKnowledge('catering-assistant', 'menu-and-prices')
    expect(detached.settings.knowledgeBaseIds).toEqual(['past-orders'])
    await expect(sampleChatbotSetupBackend.attachChatbotKnowledge('catering-assistant', 'missing')).rejects.toBeInstanceOf(BackendError)
  })
})

describe('sample teams backend', () => {
  beforeEach(() => resetSampleTeams())

  it('appends a sent message to the chat and validates the agent-call limit', async () => {
    const run = await sampleTeamsBackend.sendCoordinatorMessage('sales-team', ' Focus on offices ')
    expect(run.status).toBe('succeeded')
    const chat = await sampleTeamsBackend.listCoordinatorChat('sales-team')
    expect(chat.map((exchange) => exchange.message)).toHaveLength(2)
    expect(chat[1].message).toBe('Focus on offices')
    await expect(sampleTeamsBackend.sendCoordinatorMessage('sales-team', ' ')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(sampleTeamsBackend.setTeamMaxAgentCalls('sales-team', 0)).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await sampleTeamsBackend.setTeamMaxAgentCalls('sales-team', null)).maxAgentCallsPerRun).toBeNull()
  })
})
