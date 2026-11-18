/**
 * Mock knowledge data for screens 14 (chatbot setup), 17 (knowledge list) and 18 (knowledge detail).
 * Nothing is indexed for real: search scores are precomputed per passage and a passage
 * matches when the query contains one of its keywords.
 */

export type KnowledgeSourceType = 'PDF' | 'XLS' | 'TXT' | 'WEB'

export type KnowledgeBaseStatus = { kind: 'up-to-date' } | { kind: 'syncing'; percent: number }

export interface KnowledgeBase {
  id: string
  name: string
  status: KnowledgeBaseStatus
  /** Grey chips under the name: file counts, folder, refresh cadence. */
  facts: string[]
  usedBy: string[]
  /** Drawn with a 2px ink border on the list, marking the base opened most recently. */
  isRecentlyOpened?: boolean
}

export const knowledgeBases: KnowledgeBase[] = [
  {
    id: 'menu-and-prices',
    name: 'Catering menu and prices',
    status: { kind: 'up-to-date' },
    facts: ['3 files', '1 website', '412 passages'],
    usedBy: ['Catering assistant', 'Maps leads to WhatsApp'],
    isRecentlyOpened: true,
  },
  {
    id: 'company-documents',
    name: 'Company documents',
    status: { kind: 'syncing', percent: 64 },
    facts: ['Folder ~/Documents/Kantor', '138 files'],
    usedBy: ['Ask your documents'],
  },
  {
    id: 'past-orders',
    name: 'Past orders',
    status: { kind: 'up-to-date' },
    facts: ['Google Sheet · Orders', 'Refreshes hourly'],
    usedBy: ['Catering assistant'],
  },
]

export type KnowledgeSourceStatus = { kind: 'ready' } | { kind: 'warning'; label: string } | { kind: 'reading'; percent: number }

export interface KnowledgeSource {
  id: string
  name: string
  type: KnowledgeSourceType
  /** Optional second line, e.g. "6 pages" for a website. */
  detail?: string
  passages: string
  updates: string
  status: KnowledgeSourceStatus
}

/** Sources inside "Catering menu and prices" (screen 18). */
export const menuAndPricesSources: KnowledgeSource[] = [
  { id: 'menu-november', name: 'Menu November.pdf', type: 'PDF', passages: '186', updates: 'When the file changes', status: { kind: 'ready' } },
  { id: 'price-list', name: 'Price list.xlsx', type: 'XLS', passages: '84 rows', updates: 'When the file changes', status: { kind: 'ready' } },
  { id: 'delivery-faq', name: 'Delivery and FAQ', type: 'TXT', passages: '58', updates: 'Edited here', status: { kind: 'ready' } },
  {
    id: 'website',
    name: '[YOUR WEBSITE]',
    type: 'WEB',
    detail: '6 pages',
    passages: '84',
    updates: 'Every Monday',
    status: { kind: 'warning', label: '1 page failed' },
  },
]

/** Where a knowledge base is used (screen 18, right panel). */
export const menuAndPricesUsages = [
  { agentName: 'Catering assistant', role: 'Chatbot', agentId: 'catering-assistant' },
  { agentName: 'Maps leads to WhatsApp', role: 'Step 4', agentId: 'maps-leads' },
] as const

export interface KnowledgePassage {
  id: string
  text: string
  /** "Source · Knowledge base" line under the passage. */
  citation: string
  score: number
  keywords: string[]
  /** Shown under a weak match to tell the user what is missing. */
  weakMatchHint?: string
}

export const knowledgePassages: KnowledgePassage[] = [
  {
    id: 'free-delivery',
    text: 'Free delivery inside Bandar Lampung for orders of 30 boxes or more',
    citation: 'Delivery and FAQ · Catering menu and prices',
    score: 0.91,
    keywords: ['delivery', 'free', 'ongkir', 'gratis', 'kirim'],
  },
  {
    id: 'paid-delivery',
    text: 'Orders under 30 boxes pay delivery based on distance',
    citation: 'Menu November.pdf · page 11 · Catering menu and prices',
    score: 0.74,
    keywords: ['delivery', 'minimum', 'order', 'ongkir'],
  },
  {
    id: 'package-prices',
    text: 'Paket Hemat and Paket Komplit are priced per box, minimum 20 boxes',
    citation: 'Price list.xlsx · Catering menu and prices',
    score: 0.88,
    keywords: ['price', 'harga', 'paket', 'box'],
  },
  {
    id: 'komplit-contents',
    text: 'Paket Komplit includes chicken or fish',
    citation: 'Menu November.pdf · page 4 · Catering menu and prices',
    score: 0.41,
    keywords: ['vegetarian', 'vegan', 'sayur'],
    weakMatchHint: 'Nothing here mentions vegetarian. Add it so the chatbot stops passing this question to you',
  },
]

/**
 * Finds passages whose keywords appear in the query, best score first.
 *
 * @param query - What a customer or agent would ask
 * @param passages - Passages to search, defaults to every mock passage
 * @returns Matching passages sorted by score, empty for a blank query
 *
 * @example
 * searchKnowledgePassages('minimum order for free delivery') // [free-delivery 0.91, paid-delivery 0.74]
 */
export function searchKnowledgePassages(query: string, passages: KnowledgePassage[] = knowledgePassages): KnowledgePassage[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return []
  return passages
    .filter((passage) => passage.keywords.some((keyword) => normalizedQuery.includes(keyword)))
    .sort((first, second) => second.score - first.score)
}
