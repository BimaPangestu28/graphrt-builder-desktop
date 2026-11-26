import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'
/**
 * Simple groups for the Plugins page. The graphrt-plugins catalog has no category field,
 * so each plugin is placed by keywords in its name and description; the first rule that
 * matches wins, and anything unmatched lands in "Other".
 */

export type PluginCategory = 'messaging' | 'ai' | 'data' | 'files' | 'commerce' | 'marketing' | 'productivity' | 'web' | 'developer' | 'other'

export const pluginCategoryLabels: Readonly<Record<PluginCategory, string>> = localizedRecord(() => messages().plugins.categories)

/** Display order of the category chips. */
export const pluginCategoryOrder: PluginCategory[] = ['messaging', 'ai', 'data', 'files', 'commerce', 'marketing', 'productivity', 'web', 'developer', 'other']

/** Checked in this order: commerce before marketing (tiktok-shop), messaging before data (gmail vs sheets). */
const categoryRules: Array<{ category: PluginCategory; pattern: RegExp }> = [
  { category: 'commerce', pattern: /stripe|paypal|midtrans|xendit|shopify|woocommerce|shopee|lazada|tiktok-shop|rajaongkir|biteship|shipper|payment|invoice/ },
  {
    category: 'messaging',
    pattern: /whatsapp|telegram|slack|discord|line-messaging|teams|twilio|vonage|fonnte|wablas|qontak|gmail|email|sendgrid|resend|brevo|sms\b|messag/,
  },
  {
    category: 'ai',
    pattern:
      /openai|anthropic|gemini|groq|mistral|ollama|replicate|stability|fal-ai|ideogram|elevenlabs|deepgram|assemblyai|runway|kling|luma|minimax|veo|imagen|embedding|deepl|translate|vision|stable-audio|\bai\b|llm/,
  },
  {
    category: 'data',
    pattern:
      /postgres|mysql|sqlite|mongodb|redis|bigquery|snowflake|clickhouse|elasticsearch|dynamodb|firestore|supabase|neo4j|pinecone|qdrant|weaviate|chroma|airtable|sheets|excel|csv|state-store|database/,
  },
  { category: 'files', pattern: /drive|dropbox|onedrive|sftp|\bs3\b|local-files|pdf|ocr|docs|file|image|ffmpeg|video|audio|qr-code/ },
  {
    category: 'marketing',
    pattern: /hubspot|salesforce|pipedrive|zoho|apollo|hunter|zerobounce|mailchimp|ads\b|analytics|search-console|business-profile|meta-api|x-api|threads|linkedin|tiktok|youtube-api|crm/,
  },
  { category: 'productivity', pattern: /notion|asana|trello|jira|linear|clickup|todoist|calendar|calendly|zoom|typeform|forms|microsoft-graph/ },
  { category: 'developer', pattern: /github|gitlab|vercel|cloudflare|sentry|shell|computer-control|notifications/ },
  { category: 'web', pattern: /web|scrap|maps|rss|news|wikipedia|transcript|search|weather|meteo|bmkg|currency|holiday|libur|wilayah|bps|coingecko/ },
]

/**
 * Picks the category of a plugin from its name and description.
 *
 * @param name - Plugin name, e.g. "telegram-bot" (string)
 * @param description - Catalog description (string)
 * @returns The first matching category, or "other" (PluginCategory)
 *
 * @example
 * categorizePlugin('stripe', 'Payments and refunds') // "commerce"
 */
export function categorizePlugin(name: string, description: string): PluginCategory {
  const nameText = name.toLowerCase()
  const fullText = `${nameText} ${description.toLowerCase()}`
  const byName = categoryRules.find((rule) => rule.pattern.test(nameText))
  if (byName) return byName.category
  return categoryRules.find((rule) => rule.pattern.test(fullText))?.category ?? 'other'
}
