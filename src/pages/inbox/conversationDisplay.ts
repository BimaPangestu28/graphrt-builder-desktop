import type { Conversation, ConversationChannel } from '@/api/conversationTypes'
import { outreachOrigin } from '@/api/conversationTypes'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** How a conversation looks on the Inbox and chat detail: labels, tones and short times. */

export type ConversationTone = 'amber' | 'brand' | 'grey'

/** Hand-off reasons the builder guide suggests, as Inbox labels. Other reasons show "Waiting for you". */
const handoffReasonLabels: Readonly<Record<string, string>> = localizedRecord(() => messages().inbox.handoff)

const channelLabels: Readonly<Record<string, string>> = localizedRecord(() => ({ whatsapp: 'WhatsApp', telegram: messages().inbox.telegram, test: messages().inbox.testChat }))

export function isWaitingForYou(conversation: Pick<Conversation, 'status'>): boolean {
  return conversation.status === 'waiting_for_you'
}

/** True while the bot stays quiet and the owner should reply (waiting for you or replying). */
export function isOwnerReplying(conversation: Pick<Conversation, 'status'>): boolean {
  return conversation.status === 'waiting_for_you' || conversation.status === 'you_replying'
}

/**
 * Status pill text, e.g. "Order to confirm" for a hand-off with reason `order_to_confirm`.
 *
 * @returns The label (string)
 */
export function getConversationStatusLabel(conversation: Pick<Conversation, 'status' | 'handoffReason'>): string {
  switch (conversation.status) {
    case 'waiting_for_you':
      return (conversation.handoffReason && handoffReasonLabels[conversation.handoffReason]) || messages().inbox.waitingForYou
    case 'you_replying':
      return messages().inbox.youAreReplying
    case 'bot_answering':
      return messages().inbox.filters.botAnswering
    case 'closed':
      return messages().inbox.closed
  }
}

export function getConversationTone(conversation: Pick<Conversation, 'status'>): ConversationTone {
  if (conversation.status === 'bot_answering') return 'brand'
  if (conversation.status === 'closed') return 'grey'
  return 'amber'
}

export function getChannelLabel(channel: ConversationChannel): string {
  return channelLabels[channel] ?? channel
}

/**
 * Second line of an Inbox row: the customer's handle (or channel) and where the chat came from.
 *
 * @example
 * describeContact(conversation) // "+62 812 •••• 4410 · from outreach"
 */
export function describeContact(conversation: Pick<Conversation, 'customerName' | 'customerHandle' | 'channel' | 'origin'>): string {
  const contact = conversation.customerName === conversation.customerHandle ? getChannelLabel(conversation.channel) : conversation.customerHandle
  const label = conversation.channel === 'test' ? getChannelLabel(conversation.channel) : contact
  return conversation.origin === outreachOrigin ? messages().inbox.fromOutreachSuffix(label) : label
}

/** Last message for the Inbox row; bot messages start with "Bot: ". */
export function previewLastMessage(conversation: Pick<Conversation, 'lastMessageText' | 'lastMessageAuthor'>): string {
  if (!conversation.lastMessageText) return messages().inbox.noMessagesYet
  return conversation.lastMessageAuthor === 'bot' ? messages().inbox.botSaid(conversation.lastMessageText) : conversation.lastMessageText
}

/**
 * Short age of a timestamp: "now", "5m", "2h" or "3d".
 *
 * @param timestamp - RFC 3339 time (string)
 * @param now - Current time in ms, for tests (number)
 */
export function formatTimeAgo(timestamp: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000))
  const t = messages().inbox
  if (Number.isNaN(minutes) || minutes < 1) return t.now
  if (minutes < 60) return t.minutesShort(minutes)
  if (minutes < 24 * 60) return t.hoursShort(Math.floor(minutes / 60))
  return t.daysShort(Math.floor(minutes / (24 * 60)))
}

/** "HH:MM" in local time. */
export function formatClockTime(timestamp: string): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Turns a memory key such as `delivery_date` into "Delivery date". */
export function humanizeVariableName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
