import { callBackend, isDesktopApp, listenToBackend } from './client'
import type {
  Conversation,
  ConversationCounts,
  ConversationDetail,
  ConversationEventPayload,
  ConversationFilter,
  ConversationMessage,
} from './conversationTypes'
import { sampleConversationsBackend } from './sampleBackend/conversations'

/** Chatbot conversations (Inbox, chat detail, Try it) and their live events. Sample data outside the desktop app. */

export const CONVERSATION_EVENT = 'conversation-event'

export function listConversations(filter?: ConversationFilter): Promise<Conversation[]> {
  if (!isDesktopApp()) return sampleConversationsBackend.listConversations(filter)
  return callBackend('list_conversations', { filter: filter ?? null })
}

/** Counts per Inbox chip, for one agent or all of them. */
export function countConversations(agentId?: string): Promise<ConversationCounts> {
  if (!isDesktopApp()) return sampleConversationsBackend.countConversations(agentId)
  return callBackend('count_conversations', { agentId: agentId ?? null })
}

export function getConversation(conversationId: string): Promise<ConversationDetail> {
  if (!isDesktopApp()) return sampleConversationsBackend.getConversation(conversationId)
  return callBackend('get_conversation', { conversationId })
}

/** Opens a new chat on the in-app test channel (the chatbot's Try it panel). */
export function startTestConversation(agentId: string): Promise<ConversationDetail> {
  if (!isDesktopApp()) return sampleConversationsBackend.startTestConversation(agentId)
  return callBackend('start_test_conversation', { agentId })
}

/**
 * Writes as the customer (Try it). Resolves after the bot answered, or right away when a person
 * has the chat; the messages also arrive as `conversation-event`s.
 */
export function sendCustomerMessage(conversationId: string, text: string): Promise<ConversationDetail> {
  if (!isDesktopApp()) return sampleConversationsBackend.sendCustomerMessage(conversationId, text)
  return callBackend('send_customer_message', { conversationId, text })
}

export function takeOver(conversationId: string): Promise<Conversation> {
  if (!isDesktopApp()) return sampleConversationsBackend.takeOver(conversationId)
  return callBackend('take_over', { conversationId })
}

export function handBack(conversationId: string): Promise<Conversation> {
  if (!isDesktopApp()) return sampleConversationsBackend.handBack(conversationId)
  return callBackend('hand_back', { conversationId })
}

/** Sends the owner's reply; replying takes the chat over from the bot. */
export function sendOperatorReply(conversationId: string, text: string): Promise<ConversationMessage> {
  if (!isDesktopApp()) return sampleConversationsBackend.sendOperatorReply(conversationId, text)
  return callBackend('send_operator_reply', { conversationId, text })
}

export function closeConversation(conversationId: string): Promise<Conversation> {
  if (!isDesktopApp()) return sampleConversationsBackend.closeConversation(conversationId)
  return callBackend('close_conversation', { conversationId })
}

/** The Inbox "Bot is answering" switch for one chatbot. */
export function setBotEnabled(agentId: string, enabled: boolean): Promise<boolean> {
  if (!isDesktopApp()) return sampleConversationsBackend.setBotEnabled(agentId, enabled)
  return callBackend('set_bot_enabled', { agentId, enabled })
}

export function getBotEnabled(agentId: string): Promise<boolean> {
  if (!isDesktopApp()) return sampleConversationsBackend.getBotEnabled(agentId)
  return callBackend('get_bot_enabled', { agentId })
}

/** Live changes of every conversation. Returns an unsubscribe function. */
export function subscribeToConversationEvents(onConversationEvent: (payload: ConversationEventPayload) => void): Promise<() => void> {
  if (!isDesktopApp()) return sampleConversationsBackend.subscribeToConversationEvents(onConversationEvent)
  return listenToBackend(CONVERSATION_EVENT, onConversationEvent)
}
