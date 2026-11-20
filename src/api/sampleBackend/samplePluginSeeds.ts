import type { PluginCatalogEntry } from '../pluginTypes'

/**
 * Seed catalog for the sample plugins backend (browser preview and tests). Mirrors the
 * graphrt-plugins catalog closely enough for the screens: two WhatsApp plugins, the
 * Google Maps scraper and the website checker step from screen 12 first, then a handful
 * of other catalog plugins so the Plugins page shows several categories.
 */

/** A catalog entry before it is merged with this computer's install state. */
export type SamplePluginSeed = Omit<PluginCatalogEntry, 'installedVersion' | 'updateAvailable'>

const readmeBaseUrl = 'https://github.com/graphrt/graphrt-plugins/tree/main/plugins'

export const samplePluginSeeds: SamplePluginSeed[] = [
  {
    name: 'whatsapp-api',
    version: '0.3.0',
    description: 'Send WhatsApp messages through the official WhatsApp Business Cloud API',
    permissions: {
      network: true,
      secrets: true,
      env: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_GRAPH_VERSION'],
    },
    needsBrowser: false,
    nodes: [
      { kind: 'whatsapp-api.send_text', title: 'Send WhatsApp text', description: 'Sends a text message to a phone number' },
      { kind: 'whatsapp-api.send_template', title: 'Send WhatsApp template', description: 'Sends an approved message template' },
      { kind: 'whatsapp-api.get_business_profile', title: 'Get business profile', description: 'Reads the business profile (checks the connection)' },
    ],
    tools: ['send_whatsapp_text'],
    readmeUrl: `${readmeBaseUrl}/whatsapp-api`,
    iconUrl: null,
    warning: null,
    status: 'beta',
    tosRisk: 'none',
    sizeBytes: 48_000,
  },
  {
    name: 'whatsapp-web',
    version: '0.2.1',
    description: 'Send messages from your personal WhatsApp, linked with a QR code like WhatsApp Web',
    permissions: {
      network: true,
      secrets: true,
      env: ['WHATSAPP_WEB_PROFILE_DIR', 'WHATSAPP_WEB_IDLE_MINUTES', 'WHATSAPP_WEB_MIN_SEND_INTERVAL_SECONDS', 'WHATSAPP_WEB_DAILY_SEND_LIMIT', 'WHATSAPP_WEB_ALLOWED_FILE_DIRS'],
    },
    needsBrowser: true,
    nodes: [
      { kind: 'whatsapp-web.login', title: 'Link WhatsApp', description: 'Opens a browser window with the QR code to scan' },
      { kind: 'whatsapp-web.get_status', title: 'WhatsApp status', description: 'Whether the linked session is logged in' },
      { kind: 'whatsapp-web.send_message', title: 'Send WhatsApp message', description: 'Sends a message from your linked number (rate limited)' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/whatsapp-web`,
    iconUrl: null,
    warning:
      'Automating a personal WhatsApp account is against the WhatsApp Terms of Service. WhatsApp may ban the number, so send few messages, only to people who expect them.',
    status: 'experimental',
    tosRisk: 'high',
    sizeBytes: 120_000,
  },
  {
    name: 'google-maps-scraper',
    version: '1.1.0',
    description: 'Searches Google Maps and returns places with their phone, rating and reviews',
    permissions: { network: true, secrets: false, env: ['GOOGLE_MAPS_LANGUAGE'] },
    needsBrowser: true,
    nodes: [{ kind: 'google-maps-scraper.search', title: 'Search Google Maps', description: 'Finds places for a keyword and city' }],
    tools: ['search_google_maps'],
    readmeUrl: `${readmeBaseUrl}/google-maps-scraper`,
    iconUrl: null,
    warning: null,
    status: 'stable',
    tosRisk: 'medium',
    sizeBytes: 96_000,
  },
  {
    name: 'website-check',
    version: '0.4.0',
    description: 'Opens a website and reports if it loads and has a contact form',
    permissions: { network: true, secrets: false, env: [] },
    needsBrowser: false,
    nodes: [{ kind: 'website-check.check', title: 'Check the website', description: 'In url · Out reachable, has_form' }],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/website-check`,
    iconUrl: null,
    warning: null,
    status: null,
    tosRisk: null,
    sizeBytes: 22_000,
  },
  {
    name: 'telegram-bot',
    version: '0.1.0',
    description: 'Telegram Bot API: send messages and photos, read updates and reply in chats',
    permissions: { network: true, secrets: true, env: ['TELEGRAM_BOT_TOKEN'] },
    needsBrowser: false,
    nodes: [
      { kind: 'telegram-bot.send_message', title: 'Send Telegram message', description: 'Sends a text message to a chat' },
      { kind: 'telegram-bot.get_updates', title: 'Read new messages', description: 'Lists messages the bot received' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/telegram-bot`,
    iconUrl: null,
    warning: null,
    status: 'beta',
    tosRisk: 'none',
    sizeBytes: 30_000,
  },
  {
    name: 'openai',
    version: '0.2.0',
    description: 'OpenAI API: chat completions, structured output and embeddings with your own key',
    permissions: { network: true, secrets: true, env: ['OPENAI_API_KEY'] },
    needsBrowser: false,
    nodes: [
      { kind: 'openai.chat', title: 'Ask an OpenAI model', description: 'Sends a prompt and returns the answer' },
      { kind: 'openai.embed', title: 'Create embeddings', description: 'Turns text into vectors for search' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/openai`,
    iconUrl: null,
    warning: null,
    status: 'beta',
    tosRisk: 'none',
    sizeBytes: 34_000,
  },
  {
    name: 'google-sheets',
    version: '0.3.0',
    description: 'Read, append and update rows in a Google Sheets spreadsheet',
    permissions: { network: true, secrets: true, env: ['GOOGLE_SHEETS_CREDENTIALS_JSON'] },
    needsBrowser: false,
    nodes: [
      { kind: 'google-sheets.read_rows', title: 'Read rows', description: 'Reads a range of rows' },
      { kind: 'google-sheets.append_rows', title: 'Add rows', description: 'Appends rows at the end of a sheet' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/google-sheets`,
    iconUrl: null,
    warning: null,
    status: 'beta',
    tosRisk: 'none',
    sizeBytes: 41_000,
  },
  {
    name: 'stripe',
    version: '0.1.2',
    description: 'Stripe: list payments and customers, create payment links and refunds',
    permissions: { network: true, secrets: true, env: ['STRIPE_SECRET_KEY'] },
    needsBrowser: false,
    nodes: [
      { kind: 'stripe.list_payments', title: 'List payments', description: 'Recent payments with their status' },
      { kind: 'stripe.create_payment_link', title: 'Create payment link', description: 'A link customers can pay with' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/stripe`,
    iconUrl: null,
    warning: null,
    status: 'beta',
    tosRisk: 'none',
    sizeBytes: 38_000,
  },
  {
    name: 'pdf-tools',
    version: '0.2.0',
    description: 'Extract text from PDF files, merge and split them, all on this computer',
    permissions: { network: false, secrets: false, env: ['PDF_TOOLS_ALLOWED_DIRS'] },
    needsBrowser: false,
    nodes: [
      { kind: 'pdf-tools.extract_text', title: 'Read PDF text', description: 'Returns the text of each page' },
      { kind: 'pdf-tools.merge', title: 'Merge PDFs', description: 'Joins several PDF files into one' },
    ],
    tools: [],
    readmeUrl: `${readmeBaseUrl}/pdf-tools`,
    iconUrl: null,
    warning: null,
    status: 'stable',
    tosRisk: 'none',
    sizeBytes: 64_000,
  },
]

/** What is installed when the sample starts: the "2 installed" of the Connections mock. */
export const initiallyInstalledSamplePlugins: Array<{ name: string; version: string; trusted: boolean }> = [
  { name: 'google-maps-scraper', version: '1.0.0', trusted: true },
  { name: 'website-check', version: '0.4.0', trusted: false },
]

/**
 * Settings a plugin cannot work without (the rest of `permissions.env` is optional), so
 * the build chat asks for these and nothing more.
 */
export const sampleRequiredPluginSettings: Record<string, string[]> = {
  'whatsapp-api': ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
}

/** Name endings of tuning settings the plugins default themselves, as in `src-tauri/src/plugins/optional_settings.rs`. */
const optionalSettingSuffixes = ['_VERSION', '_MINUTES', '_SECONDS', '_LIMIT', '_DIR', '_DIRS', '_INTERVAL', '_LANGUAGE']

/** Whether a plugin works without `variable` set (same rule as the desktop backend). */
export function isOptionalSampleSetting(variable: string): boolean {
  return optionalSettingSuffixes.some((suffix) => variable.endsWith(suffix))
}

/** A plugin a sample agent's step uses although its node type is a built-in one (the preview's maps-leads agent). */
export interface SamplePluginNeed {
  pluginName: string
  stepId: string
}

/** Plugins the sample agents use, by agent id: maps-leads scrapes Google Maps and sends through the WhatsApp Cloud API. */
export const samplePluginNeedsByAgentId: Record<string, SamplePluginNeed[]> = {
  'maps-leads': [
    { pluginName: 'google-maps-scraper', stepId: 'search_maps' },
    { pluginName: 'whatsapp-api', stepId: 'send_whatsapp' },
  ],
}
