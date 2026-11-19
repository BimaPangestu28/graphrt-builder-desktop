import type { PluginCatalogEntry } from '../pluginTypes'

/**
 * Seed catalog for the sample plugins backend (browser preview and tests). Mirrors the
 * graphrt-plugins catalog closely enough for the screens: two WhatsApp plugins, the
 * Google Maps scraper and the website checker step from screen 12.
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
    sizeBytes: 22_000,
  },
]

/** What is installed when the sample starts: the "2 installed" of the Connections mock. */
export const initiallyInstalledSamplePlugins: Array<{ name: string; version: string; trusted: boolean }> = [
  { name: 'google-maps-scraper', version: '1.0.0', trusted: true },
  { name: 'website-check', version: '0.4.0', trusted: false },
]

/**
 * The ToS / ban warning a plugin's README carries, shown in the build chat before it is
 * installed (the catalog itself does not list it; the backend reads the README).
 */
export const samplePluginWarnings: Record<string, string> = {
  'whatsapp-web':
    'Automating a personal WhatsApp account is against the WhatsApp Terms of Service. WhatsApp may ban the number, so send few messages, only to people who expect them.',
}

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
