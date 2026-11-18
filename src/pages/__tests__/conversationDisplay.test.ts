import {
  describeContact,
  formatTimeAgo,
  getConversationStatusLabel,
  getConversationTone,
  humanizeVariableName,
  isOwnerReplying,
  previewLastMessage,
} from '../inbox/conversationDisplay'

describe('conversation display helpers', () => {
  it('labels statuses and hand-off reasons', () => {
    expect(getConversationStatusLabel({ status: 'waiting_for_you', handoffReason: 'order_to_confirm' })).toBe('Order to confirm')
    expect(getConversationStatusLabel({ status: 'waiting_for_you', handoffReason: 'wants a discount' })).toBe('Waiting for you')
    expect(getConversationStatusLabel({ status: 'you_replying', handoffReason: null })).toBe('You are replying')
    expect(getConversationTone({ status: 'bot_answering' })).toBe('brand')
    expect(getConversationTone({ status: 'closed' })).toBe('grey')
    expect(isOwnerReplying({ status: 'waiting_for_you' })).toBe(true)
    expect(isOwnerReplying({ status: 'bot_answering' })).toBe(false)
  })

  it('describes the contact and the last message', () => {
    expect(describeContact({ customerName: '[CAFE NAME]', customerHandle: '+62 1', channel: 'whatsapp', origin: 'outreach' })).toBe('+62 1 · from outreach')
    expect(describeContact({ customerName: '+62 1', customerHandle: '+62 1', channel: 'whatsapp', origin: null })).toBe('WhatsApp')
    expect(describeContact({ customerName: 'Test customer', customerHandle: 'test-1', channel: 'test', origin: null })).toBe('Test chat')
    expect(previewLastMessage({ lastMessageText: 'Siap kak', lastMessageAuthor: 'bot' })).toBe('Bot: Siap kak')
    expect(previewLastMessage({ lastMessageText: null, lastMessageAuthor: null })).toBe('No messages yet')
  })

  it('formats short ages and memory names', () => {
    const now = Date.parse('2026-11-18T10:00:00Z')
    expect(formatTimeAgo('2026-11-18T09:59:40Z', now)).toBe('now')
    expect(formatTimeAgo('2026-11-18T09:58:00Z', now)).toBe('2m')
    expect(formatTimeAgo('2026-11-18T07:00:00Z', now)).toBe('3h')
    expect(formatTimeAgo('2026-11-15T10:00:00Z', now)).toBe('3d')
    expect(humanizeVariableName('delivery_date')).toBe('Delivery date')
  })
})
