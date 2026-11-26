/**
 * Chatbot conversation payloads exchanged with the Rust backend. Mirrors the serde types in
 * `src-tauri/src/conversations/models.rs` and `conversations/mod.rs`. Keep both sides in sync.
 */

/**
 * Who answers a chat right now:
 * - bot_answering: the chatbot answers every customer message
 * - waiting_for_you: the bot handed the chat over and stays quiet
 * - you_replying: the owner took over
 * - closed
 */
export type ConversationStatus = 'bot_answering' | 'waiting_for_you' | 'you_replying' | 'closed'

export type MessageAuthor = 'customer' | 'bot' | 'operator' | 'system'

/** Channel adapter names. Only `test` (the Try it panel) exists today. */
export type ConversationChannel = 'test' | 'whatsapp' | 'telegram' | (string & {})

export interface Conversation {
  id: string
  agentId: string
  channel: ConversationChannel
  customerName: string
  /** Phone number or chat id on the channel. */
  customerHandle: string
  status: ConversationStatus
  /** `outreach` when an agent messaged first; null when the customer did. */
  origin: string | null
  /** Why the bot handed over, while waiting for you: order_to_confirm, asked_for_person, not_sure, bot_error, bot_paused or plain words. */
  handoffReason: string | null
  summary: string | null
  suggestedReply: string | null
  /** The workflow's `conversation.*` memory. */
  variables: Record<string, unknown>
  /** Latest customer, bot or owner message (system notices are skipped). */
  lastMessageText: string | null
  lastMessageAuthor: MessageAuthor | null
  /** RFC 3339 */
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  author: MessageAuthor
  text: string
  /** e.g. { handoffReason }, { deliveryError }, and in the sample data { sentBy: 'outreach' } or { citations } */
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ConversationDetail {
  conversation: Conversation
  /** Oldest first. */
  messages: ConversationMessage[]
}

export interface ConversationFilter {
  status?: ConversationStatus
  agentId?: string
  origin?: string
  channel?: string
  /** Defaults to 200. */
  limit?: number
}

/** Number of conversations per Inbox filter chip. */
export interface ConversationCounts {
  all: number
  botAnswering: number
  waitingForYou: number
  youReplying: number
  closed: number
  fromOutreach: number
}

/** `reply_draft` carries the bot's reply while it is written; the finished reply follows as `message_added`. */
export type ConversationEventKind = 'created' | 'message_added' | 'status_changed' | 'reply_draft'

/** Payload of the `conversation-event` Tauri event. */
export interface ConversationEventPayload {
  kind: ConversationEventKind
  conversationId: string
  agentId: string
  status: ConversationStatus
  message: ConversationMessage | null
  /** The bot's reply so far, for `reply_draft`. */
  draft?: string
}

/** Origin of conversations an outreach agent started. */
export const outreachOrigin = 'outreach'
