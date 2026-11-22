import type { ChatbotPersona, HandoffRules } from '@/api/chatbotSetupTypes'
import { chatbotToneOptions } from '@/pages/chatbot-setup/chatbotSetupOptions'

/** The sample "Catering assistant" of the browser preview and tests (screen 14). */

/** Sample persona of the "Catering assistant". */
export const sampleChatbotPersona: ChatbotPersona = {
  displayName: 'Admin Catering',
  tone: chatbotToneOptions[0],
  instructions: 'Answer questions about our menu, prices and delivery. Collect the date, number of people and address for orders. Never promise a discount',
}

/** Sample hand-off rules of the "Catering assistant". */
export const sampleHandoffRules: HandoffRules = { asksForPerson: true, notInKnowledge: true, orderReady: true, soundsUpset: false }

export interface TryItMessage {
  id: string
  sender: 'customer' | 'bot'
  paragraphs: string[]
  /** Source chips under a bot answer. */
  citations?: string[]
}

/** Opening exchange of the sample test conversation. */
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
