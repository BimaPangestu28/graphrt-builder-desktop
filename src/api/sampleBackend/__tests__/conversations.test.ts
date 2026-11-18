import { BackendError } from '../../client'
import type { ConversationEventPayload } from '../../conversationTypes'
import { resetSampleAgents } from '../agents'
import { resetSampleConversations, sampleChatbotAgentId, sampleConversationsBackend as backend } from '../conversations'

async function expectBackendError(promise: Promise<unknown>, code: BackendError['code']) {
  await expect(promise).rejects.toBeInstanceOf(BackendError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('sample conversations backend', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
  })

  it('seeds the Inbox mockup, most recently active first', async () => {
    const conversations = await backend.listConversations()
    expect(conversations.map((conversation) => conversation.id)).toEqual(['cafe-4410', 'contact-0932', 'office-7781', 'returning-5520', 'cafe-3018', 'contact-2264'])
    expect(conversations[0]).toMatchObject({
      agentId: sampleChatbotAgentId,
      channel: 'whatsapp',
      status: 'waiting_for_you',
      handoffReason: 'order_to_confirm',
      origin: 'outreach',
      lastMessageAuthor: 'customer',
      variables: { Order: '50 × Paket Komplit', Address: '' },
    })
    const detail = await backend.getConversation('cafe-4410')
    expect(detail.messages[0]).toMatchObject({ author: 'bot', metadata: { sentBy: 'outreach' } })
  })

  it('filters and counts', async () => {
    expect((await backend.listConversations({ status: 'waiting_for_you' })).map((conversation) => conversation.id)).toEqual(['cafe-4410', 'contact-0932', 'office-7781'])
    expect(await backend.listConversations({ origin: 'outreach', status: 'bot_answering' })).toHaveLength(1)
    expect(await backend.listConversations({ agentId: 'maps-leads' })).toEqual([])
    expect(await backend.listConversations({ limit: 2 })).toHaveLength(2)
    await expectBackendError(backend.listConversations({ limit: 0 }), 'invalid_input')
    expect(await backend.countConversations()).toEqual({ all: 6, botAnswering: 2, waitingForYou: 3, youReplying: 0, closed: 1, fromOutreach: 3 })
  })

  it('answers test messages from the knowledge and hands over when not sure', async () => {
    const started = await backend.startTestConversation(sampleChatbotAgentId)
    expect(started.conversation).toMatchObject({ channel: 'test', status: 'bot_answering' })
    const conversationId = started.conversation.id

    const answered = await backend.sendCustomerMessage(conversationId, 'Ongkir gratis?')
    expect(answered.messages.at(-1)).toMatchObject({ author: 'bot', metadata: { citations: [expect.any(String)] } })

    const handedOver = await backend.sendCustomerMessage(conversationId, 'Ada menu vegetarian?')
    expect(handedOver.conversation).toMatchObject({ status: 'waiting_for_you', handoffReason: 'not_sure' })
    expect(handedOver.messages.at(-1)?.text).toBe('Bot handed this to you · answer not in the knowledge')

    // While waiting for you the bot stays quiet
    const quiet = await backend.sendCustomerMessage(conversationId, 'Ongkir gratis?')
    expect(quiet.messages.at(-1)?.author).toBe('customer')
  })

  it('takes over, replies, hands back and closes', async () => {
    const takenOver = await backend.takeOver('returning-5520')
    expect(takenOver.status).toBe('you_replying')
    const afterTakeOver = await backend.sendCustomerMessage('returning-5520', 'Ongkir gratis?')
    expect(afterTakeOver.messages.at(-1)?.author).toBe('customer')

    const reply = await backend.sendOperatorReply('returning-5520', '  Iya kak  ')
    expect(reply).toMatchObject({ author: 'operator', text: 'Iya kak' })
    await expectBackendError(backend.sendOperatorReply('returning-5520', ' '), 'invalid_input')

    expect((await backend.handBack('returning-5520')).status).toBe('bot_answering')
    await expectBackendError(backend.handBack('returning-5520'), 'invalid_input')
    const answered = await backend.sendCustomerMessage('returning-5520', 'Ongkir gratis?')
    expect(answered.messages.at(-1)?.author).toBe('bot')

    expect((await backend.closeConversation('returning-5520')).status).toBe('closed')
    await expectBackendError(backend.takeOver('returning-5520'), 'invalid_input')
    const reopened = await backend.sendCustomerMessage('returning-5520', 'Halo lagi')
    expect(reopened.conversation.status).not.toBe('closed')
  })

  it('replying to a waiting chat takes it over', async () => {
    await backend.sendOperatorReply('contact-0932', 'Halo kak')
    expect((await backend.getConversation('contact-0932')).conversation.status).toBe('you_replying')
  })

  it('leaves real channel messages for you while the bot is paused', async () => {
    expect(await backend.getBotEnabled(sampleChatbotAgentId)).toBe(true)
    await backend.setBotEnabled(sampleChatbotAgentId, false)
    expect(await backend.getBotEnabled(sampleChatbotAgentId)).toBe(false)
    const detail = await backend.sendCustomerMessage('cafe-3018', 'Ongkir gratis?')
    expect(detail.conversation).toMatchObject({ status: 'waiting_for_you', handoffReason: 'bot_paused' })
    await expectBackendError(backend.setBotEnabled('nope', true), 'not_found')
  })

  it('rejects unknown conversations and non-chatbot agents', async () => {
    await expectBackendError(backend.getConversation('nope'), 'not_found')
    await expectBackendError(backend.startTestConversation('maps-leads'), 'invalid_input')
    await expectBackendError(backend.startTestConversation('nope'), 'not_found')
  })

  it('sends every change to subscribers until they unsubscribe', async () => {
    const payloads: ConversationEventPayload[] = []
    const unsubscribe = await backend.subscribeToConversationEvents((payload) => payloads.push(payload))
    await backend.takeOver('cafe-3018')
    expect(payloads.map((payload) => payload.kind)).toEqual(['status_changed', 'message_added'])
    expect(payloads[1]).toMatchObject({ conversationId: 'cafe-3018', status: 'you_replying', message: { author: 'system' } })
    unsubscribe()
    await backend.handBack('cafe-3018')
    expect(payloads).toHaveLength(2)
  })
})
