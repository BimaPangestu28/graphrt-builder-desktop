/**
 * Chatbot setup payloads (screen 14), mirroring `src-tauri/src/chatbot_setup/mod.rs` (camelCase).
 * The saved setup is applied to every bot reply: persona and rules reach the model steps,
 * switched-off hand-off rules are enforced by the app, and retrieval searches the attached knowledge.
 */

export interface ChatbotPersona {
  /** Name customers see. */
  displayName: string
  tone: string
  /** What it should do, in the owner's words. */
  instructions: string
}

/** When the bot passes the chat to the owner; each maps to a hand-off reason. */
export interface HandoffRules {
  /** `asked_for_person` */
  asksForPerson: boolean
  /** `not_sure` */
  notInKnowledge: boolean
  /** `order_to_confirm` */
  orderReady: boolean
  /** `sounds_upset` */
  soundsUpset: boolean
}

export interface ChatbotSettings {
  persona: ChatbotPersona
  handoffRules: HandoffRules
  /** Knowledge bases the bot answers from. */
  knowledgeBaseIds: string[]
  /** Connected channels switched off for this chatbot. */
  disabledChannels: string[]
}

export interface ChatbotChannel {
  /** `whatsapp` or `telegram`. */
  id: string
  name: string
  /** A channel adapter is connected (e.g. through a plugin). */
  connected: boolean
  enabled: boolean
  /** The account it answers as, when known. */
  detail: string | null
}

export interface ChatbotSetup {
  agentId: string
  settings: ChatbotSettings
  /** False until saved once; until then the bot runs its steps unchanged. */
  isSaved: boolean
  channels: ChatbotChannel[]
}
