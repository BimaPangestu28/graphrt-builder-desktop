/**
 * Customer channels of a chatbot: Telegram (a bot token from @BotFather), Slack (an app's
 * two tokens, by Socket Mode), the personal WhatsApp linked with the whatsapp-web plugin,
 * and WhatsApp Business and Microsoft Teams for a chatbot that runs online. Keep in sync
 * with `src-tauri/src/conversations/channels/`.
 */

/** Who the connected Telegram bot is (no token). */
export interface TelegramBot {
  id: string
  /** Without the `@`. */
  username: string | null
  name: string | null
}

/** How a chatbot's Telegram bot is doing. */
export type TelegramState = 'starting' | 'connected' | 'token_wrong' | 'offline' | 'other_program' | 'switched_off'

export interface TelegramConnection {
  agentId: string
  bot: TelegramBot
  /** `https://t.me/<username>`, where customers open the bot. */
  link: string | null
  state: TelegramState
}

/** The bot of a token, checked with Telegram but not saved. */
export interface TelegramTokenCheck {
  bot: TelegramBot
  link: string | null
}

export type WhatsAppWebState = 'off' | 'starting' | 'connected' | 'not_linked'

export interface WhatsAppWebChannel {
  /** The chatbot that answers the personal number. */
  agentId: string | null
  state: WhatsAppWebState
}

/** The business number Meta confirmed. */
export interface WhatsAppBusinessNumber {
  displayPhoneNumber: string | null
  verifiedName: string | null
}

/** What the owner pastes in the WhatsApp Business step (saved in the OS credential store). */
export interface WhatsAppBusinessInput {
  accessToken: string
  phoneNumberId: string
  appSecret: string
}

export interface WhatsAppBusinessSetup {
  agentId: string
  /** The values are saved and Meta confirmed the number. */
  saved: boolean
  number: WhatsAppBusinessNumber | null
  /** The chatbot runs online with WhatsApp Business on. */
  online: boolean
  /** The callback URL to enter in the Meta app, once online. */
  webhookUrl: string | null
  /** The installed graphrt tools can put WhatsApp Business online. */
  toolsReady: boolean
}

/** Who the connected Slack app is (no token). */
export interface SlackApp {
  /** The app's bot user (`U...`). */
  botUserId: string
  /** The workspace's name. */
  team: string | null
}

/** How a chatbot's Slack app is doing. */
export type SlackState = 'starting' | 'connected' | 'token_wrong' | 'offline' | 'switched_off'

export interface SlackConnection {
  agentId: string
  app: SlackApp
  state: SlackState
}

/** The two tokens of a Slack app (saved in the OS credential store, never shown again). */
export interface SlackTokens {
  /** `xoxb-...`, OAuth & Permissions › Bot User OAuth Token. */
  botToken: string
  /** `xapp-...`, Basic Information › App-Level Tokens (connections:write). */
  appToken: string
}

/** What the owner pastes in the Teams step (saved in the OS credential store). */
export interface TeamsBotInput {
  appId: string
  appPassword: string
  tenantId: string
}

export interface TeamsSetup {
  agentId: string
  /** The values are saved and Microsoft accepted them. */
  saved: boolean
  /** The chatbot runs online with Teams on. */
  online: boolean
  /** The messaging endpoint to enter in the Azure Bot, once online. */
  messagingEndpoint: string | null
  /** The installed graphrt tools can put Teams online. */
  toolsReady: boolean
}
