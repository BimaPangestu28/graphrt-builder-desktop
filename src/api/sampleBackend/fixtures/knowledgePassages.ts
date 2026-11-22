/**
 * Sample knowledge passages for the chatbot test chat and knowledge search (screens 14 and 18).
 * Nothing is indexed for real: search scores are precomputed per passage and a passage
 * matches when the query contains one of its keywords.
 */

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
