/**
 * The name people see for a plugin ("WhatsApp Cloud API") instead of its technical name
 * (`whatsapp-api`). The technical name stays the identifier: install calls, routes, logs.
 *
 * The backend sends `displayName` on catalog entries, installed plugins and requirements
 * (the catalog's curated name, else the humanized name). This module mirrors the backend
 * humanizer (`src-tauri/src/plugins/display_name.rs`) for labels that only know a name,
 * such as install progress, update summaries and errors.
 */

/** Words written in capitals: `whatsapp-api` → "… API", `s3-upload` → "S3 Upload". */
const acronymWords = new Set([
  'ai', 'api', 'aws', 'bmkg', 'crm', 'csv', 'ftp', 'gcp', 'html', 'http', 'imap', 'json', 'llm', 'ocr', 'pdf',
  'qr', 'rss', 's3', 'sftp', 'sms', 'smtp', 'sql', 'ssh', 'url', 'xml',
])

/** Brand spellings that plain capitalization gets wrong (`github` → "GitHub"). */
const brandWords: Record<string, string> = {
  bigquery: 'BigQuery',
  chatgpt: 'ChatGPT',
  github: 'GitHub',
  gitlab: 'GitLab',
  graphql: 'GraphQL',
  hubspot: 'HubSpot',
  linkedin: 'LinkedIn',
  mongodb: 'MongoDB',
  mysql: 'MySQL',
  openai: 'OpenAI',
  paypal: 'PayPal',
  postgresql: 'PostgreSQL',
  sendgrid: 'SendGrid',
  sqlite: 'SQLite',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  woocommerce: 'WooCommerce',
  wordpress: 'WordPress',
  youtube: 'YouTube',
}

/** Joining words kept lower-case after the first word ("PDF to Text"). */
const lowercaseJoiningWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with'])

function humanizeWord(word: string, index: number): string {
  if (word !== word.toLowerCase()) return word
  if (acronymWords.has(word)) return word.toUpperCase()
  if (Object.hasOwn(brandWords, word)) return brandWords[word]
  if (index > 0 && lowercaseJoiningWords.has(word)) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * A plugin name as words people read: acronyms in capitals, known brands spelled their
 * way, small joining words lower-case, words with capitals kept as written.
 *
 * @param pluginName - Technical name, e.g. "currency-rates" (string)
 * @returns The humanized name, e.g. "Currency Rates"; blank for a blank name (string)
 *
 * @example
 * humanizePluginName('whatsapp-api') // "WhatsApp API"
 * humanizePluginName('pdf-to-text') // "PDF to Text"
 */
export function humanizePluginName(pluginName: string): string {
  return pluginName
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map(humanizeWord)
    .join(' ')
}

/** Anything that names a plugin: a catalog entry, an installed plugin, a requirement. */
export interface NamedPlugin {
  name: string
  displayName?: string | null
}

/**
 * The label of a plugin: its display name, else the humanized technical name.
 *
 * @param plugin - Something with `name` and maybe `displayName` (NamedPlugin)
 * @returns The name to show people (string)
 *
 * @example
 * pluginDisplayName({ name: 'github', displayName: null }) // "GitHub"
 */
export function pluginDisplayName(plugin: NamedPlugin): string {
  const curatedName = plugin.displayName?.trim()
  return curatedName ? curatedName : humanizePluginName(plugin.name)
}

/**
 * The label of the plugin named `pluginName`, looked up in `knownPlugins` (catalog
 * entries, installed plugins) and humanized when none of them lists it.
 *
 * @param knownPlugins - Plugins with display names, e.g. the inventory (Iterable<NamedPlugin>)
 * @param pluginName - Technical name (string)
 * @returns The name to show people (string)
 */
export function findPluginDisplayName(knownPlugins: Iterable<NamedPlugin>, pluginName: string): string {
  for (const plugin of knownPlugins) {
    if (plugin.name === pluginName) return pluginDisplayName(plugin)
  }
  return humanizePluginName(pluginName)
}
