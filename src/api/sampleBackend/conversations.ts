import { BackendError } from '../client'
import {
  outreachOrigin,
  type Conversation,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationEventKind,
  type ConversationEventPayload,
  type ConversationFilter,
  type ConversationMessage,
  type ConversationStatus,
  type MessageAuthor,
} from '../conversationTypes'
import { initialTryItMessages } from '@/data/chatbotSetup'
import { inboxConversations, type ChatMessage, type InboxConversation } from '@/data/inbox'
import { searchKnowledgePassages } from '@/data/knowledge'
import { readStoredAgent } from './sampleAgentStore'
import { requireText, respondWith } from './sampleResponse'

/**
 * Sample conversations for the browser preview and tests, kept in memory.
 *
 * - Seeded from the Inbox mockup (`src/data/inbox.ts`): six WhatsApp chats of the
 *   "catering-assistant" chatbot, three of them waiting for you.
 * - The sample bot answers from the mock knowledge (`searchKnowledgePassages`) and hands the
 *   chat over (`not_sure`) when nothing matches, like the hand-off outputs of a real workflow.
 * - Every new test conversation starts with the Try it demo exchange.
 *
 * Every change goes to {@link sampleConversationsBackend.subscribeToConversationEvents}
 * subscribers, like the Tauri `conversation-event`. Call {@link resetSampleConversations} in tests.
 */

/** Chatbot the seeded conversations belong to. */
export const sampleChatbotAgentId = 'catering-assistant'

const minuteMs = 60_000
const sampleHandoffReasons: Partial<Record<InboxConversation['status'], string>> = {
  'order-to-confirm': 'order_to_confirm',
  'asked-for-you': 'asked_for_person',
  'bot-not-sure': 'not_sure',
}

let storedConversations: Conversation[] = []
let messagesByConversationId = new Map<string, ConversationMessage[]>()
let botDisabledAgentIds = new Set<string>()
let conversationSubscribers = new Set<(payload: ConversationEventPayload) => void>()
let createdCount = 0

function parseTimeAgo(timeAgo: string): number {
  const amount = Number.parseInt(timeAgo, 10) || 0
  return timeAgo.endsWith('h') ? amount * 60 : amount
}

function todayAt(clockTime: string, now: number): number {
  const [hours, minutes] = clockTime.split(':').map(Number)
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

const seedAuthors: Record<ChatMessage['author'], MessageAuthor> = {
  customer: 'customer',
  bot: 'bot',
  'outreach-agent': 'bot',
  you: 'operator',
  notice: 'system',
}

function seedMessages(inboxConversation: InboxConversation, lastActivity: number): ConversationMessage[] {
  const firstTimedMessage = inboxConversation.messages.find((message) => message.time)
  let messageTime = firstTimedMessage?.time ? todayAt(firstTimedMessage.time, lastActivity) : lastActivity - inboxConversation.messages.length * minuteMs
  return inboxConversation.messages.map((message) => {
    messageTime = message.time ? todayAt(message.time, lastActivity) : messageTime + minuteMs
    return {
      id: `${inboxConversation.id}-${message.id}`,
      conversationId: inboxConversation.id,
      author: seedAuthors[message.author],
      text: message.text,
      metadata: message.author === 'outreach-agent' ? { sentBy: 'outreach' } : {},
      createdAt: new Date(messageTime).toISOString(),
    }
  })
}

/** Collected order details become the bot's `conversation.*` memory; "Missing" stays empty. */
function seedVariables(inboxConversation: InboxConversation): Record<string, unknown> {
  const rows = inboxConversation.summary?.orderRows ?? []
  return Object.fromEntries(rows.map((row) => [row.label, row.isMissing ? '' : row.value]))
}

function seedConversation(inboxConversation: InboxConversation, now: number): Conversation {
  const lastActivity = now - parseTimeAgo(inboxConversation.timeAgo) * minuteMs
  const status: ConversationStatus =
    inboxConversation.status === 'bot-answering' ? 'bot_answering' : inboxConversation.status === 'closed' ? 'closed' : 'waiting_for_you'
  return {
    id: inboxConversation.id,
    agentId: sampleChatbotAgentId,
    channel: 'whatsapp',
    customerName: inboxConversation.customerName,
    customerHandle: inboxConversation.phoneNumber,
    status,
    origin: inboxConversation.isFromOutreach ? outreachOrigin : null,
    handoffReason: sampleHandoffReasons[inboxConversation.status] ?? null,
    summary: inboxConversation.summary?.botSummary ?? null,
    suggestedReply: inboxConversation.suggestedReply ?? null,
    variables: seedVariables(inboxConversation),
    lastMessageText: null,
    lastMessageAuthor: null,
    createdAt: new Date(lastActivity - 30 * minuteMs).toISOString(),
    updatedAt: new Date(lastActivity).toISOString(),
  }
}

/** Puts the seeded conversations back, turns every bot on and drops subscribers. */
export function resetSampleConversations(): void {
  const now = Date.now()
  createdCount = 0
  botDisabledAgentIds = new Set()
  conversationSubscribers = new Set()
  storedConversations = inboxConversations.map((inboxConversation) => seedConversation(inboxConversation, now))
  messagesByConversationId = new Map(
    inboxConversations.map((inboxConversation) => [inboxConversation.id, seedMessages(inboxConversation, now - parseTimeAgo(inboxConversation.timeAgo) * minuteMs)]),
  )
}

resetSampleConversations()

function nextId(prefix: string): string {
  createdCount += 1
  return `${prefix}-${createdCount}`
}

function findConversation(conversationId: string): Conversation {
  const conversation = storedConversations.find((storedConversation) => storedConversation.id === conversationId)
  if (!conversation) throw new BackendError('not_found', `conversation ${conversationId} not found`)
  return conversation
}

/** The stored conversation with its latest message filled in, like the backend's list query. */
function withLastMessage(conversation: Conversation): Conversation {
  const lastMessage = [...(messagesByConversationId.get(conversation.id) ?? [])].reverse().find((message) => message.author !== 'system')
  return { ...conversation, lastMessageText: lastMessage?.text ?? null, lastMessageAuthor: lastMessage?.author ?? null }
}

function notifySubscribers(kind: ConversationEventKind, conversation: Conversation, message: ConversationMessage | null = null): void {
  const payload: ConversationEventPayload = { kind, conversationId: conversation.id, agentId: conversation.agentId, status: conversation.status, message }
  conversationSubscribers.forEach((onConversationEvent) => {
    try {
      onConversationEvent(payload)
    } catch (subscriberError) {
      console.error('Conversation event subscriber failed', subscriberError)
    }
  })
}

function saveConversation(conversationId: string, changes: Partial<Conversation>): Conversation {
  const changedConversation = { ...findConversation(conversationId), ...changes, updatedAt: new Date().toISOString() }
  storedConversations = storedConversations.map((storedConversation) => (storedConversation.id === conversationId ? changedConversation : storedConversation))
  return changedConversation
}

function addMessage(conversationId: string, author: MessageAuthor, text: string, metadata: Record<string, unknown> = {}): ConversationMessage {
  const message: ConversationMessage = { id: nextId('message'), conversationId, author, text, metadata, createdAt: new Date().toISOString() }
  messagesByConversationId.set(conversationId, [...(messagesByConversationId.get(conversationId) ?? []), message])
  notifySubscribers('message_added', saveConversation(conversationId, {}), message)
  return message
}

function changeStatus(conversationId: string, status: ConversationStatus, handoffReason: string | null = null): Conversation {
  const conversation = saveConversation(conversationId, { status, handoffReason: status === 'waiting_for_you' ? handoffReason : null })
  notifySubscribers('status_changed', conversation)
  return conversation
}

function readDetail(conversationId: string): ConversationDetail {
  return { conversation: withLastMessage(findConversation(conversationId)), messages: [...(messagesByConversationId.get(conversationId) ?? [])] }
}

function matchesFilter(conversation: Conversation, filter: ConversationFilter): boolean {
  return (
    (!filter.status || conversation.status === filter.status) &&
    (!filter.agentId || conversation.agentId === filter.agentId) &&
    (!filter.origin || conversation.origin === filter.origin) &&
    (!filter.channel || conversation.channel === filter.channel)
  )
}

function listMatching(filter: ConversationFilter = {}): Conversation[] {
  const limit = filter.limit ?? 200
  if (limit < 1) throw new BackendError('invalid_input', `limit must be at least 1, got ${limit}`)
  return storedConversations
    .filter((conversation) => matchesFilter(conversation, filter))
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    .slice(0, limit)
    .map(withLastMessage)
}

function countMatching(agentId?: string): ConversationCounts {
  const conversations = storedConversations.filter((conversation) => !agentId || conversation.agentId === agentId)
  const countStatus = (status: ConversationStatus) => conversations.filter((conversation) => conversation.status === status).length
  return {
    all: conversations.length,
    botAnswering: countStatus('bot_answering'),
    waitingForYou: countStatus('waiting_for_you'),
    youReplying: countStatus('you_replying'),
    closed: countStatus('closed'),
    fromOutreach: conversations.filter((conversation) => conversation.origin === outreachOrigin).length,
  }
}

function requireChatbot(agentId: string): void {
  const agent = readStoredAgent(agentId)
  if (agent.kind !== 'chatbot') throw new BackendError('invalid_input', `${agent.name} is not a chatbot`)
}

function startTestChat(agentId: string): ConversationDetail {
  requireChatbot(agentId)
  const now = new Date().toISOString()
  const conversation: Conversation = {
    id: nextId('test-chat'),
    agentId,
    channel: 'test',
    customerName: 'Test customer',
    customerHandle: 'test-customer',
    status: 'bot_answering',
    origin: null,
    handoffReason: null,
    summary: null,
    suggestedReply: null,
    variables: {},
    lastMessageText: null,
    lastMessageAuthor: null,
    createdAt: now,
    updatedAt: now,
  }
  storedConversations = [conversation, ...storedConversations]
  messagesByConversationId.set(
    conversation.id,
    initialTryItMessages.map((demoMessage) => ({
      id: nextId('message'),
      conversationId: conversation.id,
      author: demoMessage.sender,
      text: demoMessage.paragraphs.join('\n\n'),
      metadata: demoMessage.citations ? { citations: demoMessage.citations } : {},
      createdAt: now,
    })),
  )
  notifySubscribers('created', conversation)
  return readDetail(conversation.id)
}

/** The sample bot: answers from the mock knowledge, or hands over when it is not sure. */
function answerAsSampleBot(conversationId: string, customerText: string): void {
  const bestPassage = searchKnowledgePassages(customerText)[0]
  if (!bestPassage || bestPassage.score < 0.55) {
    addMessage(conversationId, 'bot', 'Sebentar ya kak, saya sambungkan ke admin kami')
    changeStatus(conversationId, 'waiting_for_you', 'not_sure')
    addMessage(conversationId, 'system', 'Bot handed this to you · answer not in the knowledge', { handoffReason: 'not_sure' })
    return
  }
  const sourceName = bestPassage.citation.split(' · ').slice(0, -1).join(' · ')
  addMessage(conversationId, 'bot', bestPassage.text, { citations: [sourceName] })
}

function receiveCustomerMessage(conversationId: string, text: string): ConversationDetail {
  const customerText = requireText(text, 'message text must not be empty')
  let conversation = findConversation(conversationId)
  if (conversation.status === 'closed') conversation = changeStatus(conversationId, 'bot_answering')
  addMessage(conversationId, 'customer', customerText)
  if (conversation.status !== 'bot_answering') return readDetail(conversationId)
  if (conversation.channel !== 'test' && botDisabledAgentIds.has(conversation.agentId)) {
    changeStatus(conversationId, 'waiting_for_you', 'bot_paused')
    addMessage(conversationId, 'system', 'Bot is paused · waiting for you', { handoffReason: 'bot_paused' })
  } else {
    answerAsSampleBot(conversationId, customerText)
  }
  return readDetail(conversationId)
}

function takeOverChat(conversationId: string): Conversation {
  const conversation = findConversation(conversationId)
  if (conversation.status === 'closed') throw new BackendError('invalid_input', 'this chat is closed')
  if (conversation.status === 'you_replying') return withLastMessage(conversation)
  changeStatus(conversationId, 'you_replying')
  addMessage(conversationId, 'system', 'You took over · bot paused')
  return withLastMessage(findConversation(conversationId))
}

function handBackChat(conversationId: string): Conversation {
  const conversation = findConversation(conversationId)
  if (conversation.status === 'bot_answering') throw new BackendError('invalid_input', 'the bot is already answering')
  if (conversation.status === 'closed') throw new BackendError('invalid_input', 'this chat is closed')
  changeStatus(conversationId, 'bot_answering')
  addMessage(conversationId, 'system', 'You handed this back to the bot')
  return withLastMessage(findConversation(conversationId))
}

function replyAsOperator(conversationId: string, text: string): ConversationMessage {
  const replyText = requireText(text, 'write a reply first')
  if (findConversation(conversationId).status !== 'you_replying') takeOverChat(conversationId)
  return addMessage(conversationId, 'operator', replyText)
}

function closeChat(conversationId: string): Conversation {
  if (findConversation(conversationId).status !== 'closed') {
    changeStatus(conversationId, 'closed')
    addMessage(conversationId, 'system', 'Chat closed')
  }
  return withLastMessage(findConversation(conversationId))
}

function changeBotEnabled(agentId: string, enabled: boolean): boolean {
  readStoredAgent(agentId)
  if (enabled) botDisabledAgentIds.delete(agentId)
  else botDisabledAgentIds.add(agentId)
  return enabled
}

export const sampleConversationsBackend = {
  listConversations: (filter?: ConversationFilter): Promise<Conversation[]> => respondWith(() => listMatching(filter)),
  countConversations: (agentId?: string): Promise<ConversationCounts> => respondWith(() => countMatching(agentId)),
  getConversation: (conversationId: string): Promise<ConversationDetail> => respondWith(() => readDetail(conversationId)),
  startTestConversation: (agentId: string): Promise<ConversationDetail> => respondWith(() => startTestChat(agentId)),
  sendCustomerMessage: (conversationId: string, text: string): Promise<ConversationDetail> => respondWith(() => receiveCustomerMessage(conversationId, text)),
  takeOver: (conversationId: string): Promise<Conversation> => respondWith(() => takeOverChat(conversationId)),
  handBack: (conversationId: string): Promise<Conversation> => respondWith(() => handBackChat(conversationId)),
  sendOperatorReply: (conversationId: string, text: string): Promise<ConversationMessage> => respondWith(() => replyAsOperator(conversationId, text)),
  closeConversation: (conversationId: string): Promise<Conversation> => respondWith(() => closeChat(conversationId)),
  setBotEnabled: (agentId: string, enabled: boolean): Promise<boolean> => respondWith(() => changeBotEnabled(agentId, enabled)),
  getBotEnabled: (agentId: string): Promise<boolean> =>
    respondWith(() => {
      readStoredAgent(agentId)
      return !botDisabledAgentIds.has(agentId)
    }),
  subscribeToConversationEvents: (onConversationEvent: (payload: ConversationEventPayload) => void): Promise<() => void> => {
    conversationSubscribers.add(onConversationEvent)
    return Promise.resolve(() => {
      conversationSubscribers.delete(onConversationEvent)
    })
  },
}
