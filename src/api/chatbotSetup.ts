import { callBackend, isDesktopApp } from './client'
import type { ChatbotSettings, ChatbotSetup } from './chatbotSetupTypes'
import { sampleChatbotSetupBackend } from './sampleBackend/chatbotSetup'

/** A chatbot's persona, hand-off rules, knowledge and channels (screen 14). Sample data outside the desktop app. */

/**
 * @throws BackendError - `invalid_input` when the agent is not a chatbot, `not_found` for an unknown agent
 */
export function getChatbotSetup(agentId: string): Promise<ChatbotSetup> {
  if (!isDesktopApp()) return sampleChatbotSetupBackend.getChatbotSetup(agentId)
  return callBackend('get_chatbot_setup', { agentId })
}

/** Saves the setup; the bot's next reply uses it. */
export function saveChatbotSettings(agentId: string, settings: ChatbotSettings): Promise<ChatbotSetup> {
  if (!isDesktopApp()) return sampleChatbotSetupBackend.saveChatbotSettings(agentId, settings)
  return callBackend('save_chatbot_settings', { agentId, settings })
}

/** Lets the chatbot answer from a knowledge base (see `src/api/knowledge.ts` for the bases). */
export function attachChatbotKnowledge(agentId: string, knowledgeBaseId: string): Promise<ChatbotSetup> {
  if (!isDesktopApp()) return sampleChatbotSetupBackend.attachChatbotKnowledge(agentId, knowledgeBaseId)
  return callBackend('attach_chatbot_knowledge', { agentId, knowledgeBaseId })
}

export function detachChatbotKnowledge(agentId: string, knowledgeBaseId: string): Promise<ChatbotSetup> {
  if (!isDesktopApp()) return sampleChatbotSetupBackend.detachChatbotKnowledge(agentId, knowledgeBaseId)
  return callBackend('detach_chatbot_knowledge', { agentId, knowledgeBaseId })
}
