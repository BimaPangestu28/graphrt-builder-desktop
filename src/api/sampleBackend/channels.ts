import { BackendError } from '../client'
import type {
  TelegramConnection,
  TelegramTokenCheck,
  WhatsAppBusinessInput,
  WhatsAppBusinessNumber,
  WhatsAppBusinessSetup,
  WhatsAppWebChannel,
} from '../channelTypes'
import { respondWith } from './sampleResponse'

/**
 * Sample customer channels for the browser preview and tests, kept in memory. A token of
 * the form `123456:ABC…` is accepted as the bot "Toko Kue Bot"; `000000:revoked` is refused
 * like a revoked token. Nothing is ever stored but the bot's name.
 * Call {@link resetSampleChannels} in tests to start empty.
 */

const sampleBot = { id: '4242', username: 'toko_kue_bot', name: 'Toko Kue Bot' }
const tokenShape = /^\d{5,}:[A-Za-z0-9_-]{6,}$/

let telegramByAgent = new Map<string, TelegramConnection>()
let whatsAppWebAgent: string | null = null
let businessByAgent = new Map<string, WhatsAppBusinessNumber>()

export function resetSampleChannels(): void {
  telegramByAgent = new Map()
  whatsAppWebAgent = null
  businessByAgent = new Map()
}

function checkedToken(token: string): TelegramTokenCheck {
  const trimmed = token.trim()
  if (!tokenShape.test(trimmed)) {
    throw new BackendError('invalid_input', 'this is not a Telegram bot token. Copy the whole token @BotFather sent, it looks like 123456789:AAE…')
  }
  if (trimmed.endsWith(':revoked')) {
    throw new BackendError('invalid_input', 'Telegram does not know this token. It is wrong, or it was revoked in @BotFather: copy it again')
  }
  return { bot: { ...sampleBot }, link: `https://t.me/${sampleBot.username}` }
}

/** The account the sample chatbot answers as on Telegram (`@toko_kue_bot`), or null. */
export function sampleTelegramAccount(agentId: string): string | null {
  const connection = telegramByAgent.get(agentId)
  return connection?.bot.username ? `@${connection.bot.username}` : null
}

/** The chatbot that answers the sample personal WhatsApp. */
export function sampleWhatsAppWebAgent(): string | null {
  return whatsAppWebAgent
}

export const sampleChannelsBackend = {
  checkTelegramToken: (token: string): Promise<TelegramTokenCheck> => respondWith(() => checkedToken(token)),

  connectTelegram: (agentId: string, token: string): Promise<TelegramConnection> =>
    respondWith(() => {
      const checked = checkedToken(token)
      const connection: TelegramConnection = { agentId, bot: checked.bot, link: checked.link, state: 'connected' }
      telegramByAgent.set(agentId, connection)
      return { ...connection }
    }),

  disconnectTelegram: (agentId: string): Promise<void> =>
    respondWith(() => {
      telegramByAgent.delete(agentId)
    }),

  getTelegramConnection: (agentId: string): Promise<TelegramConnection | null> =>
    respondWith(() => {
      const connection = telegramByAgent.get(agentId)
      return connection ? { ...connection } : null
    }),

  getWhatsAppWebChannel: (): Promise<WhatsAppWebChannel> =>
    respondWith(() => ({ agentId: whatsAppWebAgent, state: whatsAppWebAgent ? 'connected' : 'off' })),

  setWhatsAppWebChatbot: (agentId: string | null): Promise<WhatsAppWebChannel> =>
    respondWith(() => {
      whatsAppWebAgent = agentId
      return { agentId, state: agentId ? 'connected' : 'off' }
    }),

  getWhatsAppBusinessSetup: (agentId: string): Promise<WhatsAppBusinessSetup> =>
    respondWith(() => {
      const number = businessByAgent.get(agentId) ?? null
      return { agentId, saved: number !== null, number, online: false, webhookUrl: null, toolsReady: true }
    }),

  saveWhatsAppBusiness: (agentId: string, input: WhatsAppBusinessInput): Promise<WhatsAppBusinessNumber> =>
    respondWith(() => {
      if (!/^\d{6,}$/.test(input.phoneNumberId.trim())) {
        throw new BackendError('invalid_input', 'Check the values: the phone number ID is a long number (WhatsApp › API Setup), and the access token is not empty')
      }
      if (!input.accessToken.trim() || !input.appSecret.trim()) {
        throw new BackendError('invalid_input', 'Paste the access token and the app secret from the Meta app')
      }
      const number = { displayPhoneNumber: '+62 812-3456-7890', verifiedName: 'Toko Kue Sari' }
      businessByAgent.set(agentId, number)
      return { ...number }
    }),

  revealWhatsAppVerifyToken: (agentId: string): Promise<string> =>
    respondWith(() => {
      if (!businessByAgent.has(agentId)) throw new BackendError('missing_credentials', 'WhatsApp Business (save the values first)')
      return 'sample-verify-token-3f9c2a'
    }),

  forgetWhatsAppBusiness: (agentId: string): Promise<void> =>
    respondWith(() => {
      businessByAgent.delete(agentId)
    }),
}
