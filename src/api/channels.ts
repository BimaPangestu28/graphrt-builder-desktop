import { callBackend, isDesktopApp } from './client'
import type {
  SlackApp,
  SlackConnection,
  SlackTokens,
  TeamsBotInput,
  TeamsSetup,
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

/**
 * Checks the two tokens of a Slack app with Slack, without saving them.
 * @throws BackendError - `invalid_input` with a plain sentence (wrong token, missing scope, no internet)
 */
export function checkSlackTokens(tokens: SlackTokens): Promise<SlackApp> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.checkSlackTokens(tokens)
  return callBackend('check_slack_tokens', { tokens })
}

/** Connects the Slack app to the chatbot; it answers in Slack from now on. */
export function connectSlack(agentId: string, tokens: SlackTokens): Promise<SlackConnection> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.connectSlack(agentId, tokens)
  return callBackend('connect_slack', { agentId, tokens })
}

export function disconnectSlack(agentId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.disconnectSlack(agentId)
  return callBackend('disconnect_slack', { agentId })
}

/** The chatbot's Slack app and how it is doing; `null` without one. */
export function getSlackConnection(agentId: string): Promise<SlackConnection | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.getSlackConnection(agentId)
  return callBackend('get_slack_connection', { agentId })
}

export function getTeamsSetup(agentId: string): Promise<TeamsSetup> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.getTeamsSetup(agentId)
  return callBackend('get_teams_setup', { agentId })
}

/**
 * Checks the Azure Bot's values with Microsoft and saves them in the OS credential store.
 * @throws BackendError - `invalid_input` with a plain sentence when Microsoft refuses
 */
export function saveTeamsBot(agentId: string, input: TeamsBotInput): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.saveTeamsBot(agentId, input)
  return callBackend('save_teams_bot', { agentId, input })
}

export function forgetTeamsBot(agentId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleChannelsBackend.forgetTeamsBot(agentId)
  return callBackend('forget_teams_bot', { agentId })
}
