import { callBackend, isDesktopApp } from './client'
import type {
  TelegramConnection,
  TelegramTokenCheck,
  WhatsAppBusinessInput,
  WhatsAppBusinessNumber,
  WhatsAppBusinessSetup,
  WhatsAppWebChannel,
} from './channelTypes'
import { sampleChannelsBackend } from './sampleBackend/channels'

/**
 * The connect step of a chatbot's customer channels. Tokens go to the OS credential store
 * and never come back. Sample data outside the desktop app.
 */

/**
 * Asks Telegram who the bot of `token` is, without saving it.
 * @throws BackendError - `invalid_input` with a plain sentence (wrong token, no internet)
 */
export function checkTelegramToken(token: string): Promise<TelegramTokenCheck> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.checkTelegramToken(token)
  return callBackend('check_telegram_token', { token })
}

/** Connects the bot of `token` to the chatbot; it answers customers from now on. */
export function connectTelegram(agentId: string, token: string): Promise<TelegramConnection> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.connectTelegram(agentId, token)
  return callBackend('connect_telegram', { agentId, token })
}

export function disconnectTelegram(agentId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.disconnectTelegram(agentId)
  return callBackend('disconnect_telegram', { agentId })
}

/** The chatbot's Telegram bot and how it is doing; `null` without one. */
export function getTelegramConnection(agentId: string): Promise<TelegramConnection | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.getTelegramConnection(agentId)
  return callBackend('get_telegram_connection', { agentId })
}

export function getWhatsAppWebChannel(): Promise<WhatsAppWebChannel> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.getWhatsAppWebChannel()
  return callBackend('get_whatsapp_web_channel')
}

/** Lets a chatbot answer the personal WhatsApp (`null`: none does). */
export function setWhatsAppWebChatbot(agentId: string | null): Promise<WhatsAppWebChannel> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.setWhatsAppWebChatbot(agentId)
  return callBackend('set_whatsapp_web_chatbot', { agentId })
}

export function getWhatsAppBusinessSetup(agentId: string): Promise<WhatsAppBusinessSetup> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.getWhatsAppBusinessSetup(agentId)
  return callBackend('get_whatsapp_business_setup', { agentId })
}

/**
 * Checks the values with Meta and saves them in the OS credential store.
 * @throws BackendError - `invalid_input` with a plain sentence when Meta refuses
 */
export function saveWhatsAppBusiness(agentId: string, input: WhatsAppBusinessInput): Promise<WhatsAppBusinessNumber> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.saveWhatsAppBusiness(agentId, input)
  return callBackend('save_whatsapp_business', { agentId, input })
}

/** The verify token to type into the Meta app (shown on request only). */
export function revealWhatsAppVerifyToken(agentId: string): Promise<string> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.revealWhatsAppVerifyToken(agentId)
  return callBackend('reveal_whatsapp_verify_token', { agentId })
}

export function forgetWhatsAppBusiness(agentId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.forgetWhatsAppBusiness(agentId)
  return callBackend('forget_whatsapp_business', { agentId })
}
