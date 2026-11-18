import type { KnowledgeSourceType } from './knowledge'

/** Mock state for the Catering assistant chatbot setup (screen 14). */

export interface ChatbotPersona {
  displayName: string
  tone: string
  instructions: string
}

export const chatbotToneOptions = ['Friendly, casual Indonesian', 'Formal'] as const

export const initialChatbotPersona: ChatbotPersona = {
  displayName: 'Admin Catering',
  tone: chatbotToneOptions[0],
  instructions: 'Answer questions about our menu, prices and delivery. Collect the date, number of people and address for orders. Never promise a discount',
}

export interface ChatbotKnowledgeFile {
  id: string
  name: string
  type: KnowledgeSourceType
  /** "12 pages · ready" when indexed, otherwise reading progress. */
  progress: { kind: 'ready'; summary: string } | { kind: 'reading'; percent: number }
}

export const initialChatbotKnowledgeFiles: ChatbotKnowledgeFile[] = [
  { id: 'menu-november', name: 'Menu November.pdf', type: 'PDF', progress: { kind: 'ready', summary: '12 pages · ready' } },
  { id: 'price-list', name: 'Price list.xlsx', type: 'XLS', progress: { kind: 'ready', summary: '84 rows · ready' } },
  { id: 'delivery-faq', name: 'Delivery and FAQ', type: 'TXT', progress: { kind: 'reading', percent: 60 } },
]

export interface HandoffRule {
  id: string
  label: string
  isEnabled: boolean
}

export const initialHandoffRules: HandoffRule[] = [
  { id: 'asks-for-person', label: 'The customer asks for a person', isEnabled: true },
  { id: 'not-in-knowledge', label: 'The answer is not in the knowledge', isEnabled: true },
  { id: 'order-ready', label: 'An order is ready to confirm', isEnabled: true },
  { id: 'sounds-upset', label: 'The customer sounds upset', isEnabled: false },
]

export interface TryItMessage {
  id: string
  sender: 'customer' | 'bot'
  paragraphs: string[]
  /** Source chips under a bot answer. */
  citations?: string[]
}

export const initialTryItMessages: TryItMessage[] = [
  {
    id: 'try-1',
    sender: 'customer',
    paragraphs: ['Halo kak, ada paket nasi box buat 50 orang? Kirim ke kantor di Rajabasa hari Jumat'],
  },
  {
    id: 'try-2',
    sender: 'bot',
    paragraphs: [
      'Halo kak, ada. Untuk 50 orang bisa pilih Paket Hemat atau Paket Komplit, harganya [PRICE] dan [PRICE] per box. Ongkir ke Rajabasa gratis untuk pesanan di atas 30 box',
      'Jumat ini jam berapa dikirimnya kak?',
    ],
    citations: ['Menu November.pdf · p2', 'Delivery and FAQ'],
  },
]
