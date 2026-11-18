/**
 * Mock conversations for the chatbot inbox (screen 15) and chat detail (screen 16).
 * Customer text stays in Indonesian, as in the mockup; UI text is English.
 */

export type ConversationStatus = 'order-to-confirm' | 'asked-for-you' | 'bot-not-sure' | 'bot-answering' | 'closed'

export const conversationStatusLabels: Record<ConversationStatus, string> = {
  'order-to-confirm': 'Order to confirm',
  'asked-for-you': 'Asked for you',
  'bot-not-sure': 'Bot not sure',
  'bot-answering': 'Bot answering',
  closed: 'Closed',
}

/** Statuses where the bot stopped and a person has to reply. */
const waitingStatuses: ConversationStatus[] = ['order-to-confirm', 'asked-for-you', 'bot-not-sure']

export type ChatMessageAuthor = 'customer' | 'bot' | 'outreach-agent' | 'you' | 'notice'

export interface ChatMessage {
  id: string
  author: ChatMessageAuthor
  text: string
  /** HH:MM, shown for agent, bot and your own messages. */
  time?: string
}

export interface OrderSummaryRow {
  label: string
  value: string
  isMissing?: boolean
}

export interface CustomerSummary {
  botSummary: string
  orderRows: OrderSummaryRow[]
  cameFrom: string
}

export interface InboxConversation {
  id: string
  customerName: string
  /** Second line on the inbox row, e.g. "+62 812 •••• 4410 · from outreach". */
  contactDetail: string
  /** Number shown under the name in the chat header. */
  phoneNumber: string
  lastMessage: string
  status: ConversationStatus
  timeAgo: string
  isFromOutreach: boolean
  messages: ChatMessage[]
  summary?: CustomerSummary
  /** Reply the bot proposes for you, shown above the composer. */
  suggestedReply?: string
}

export function isWaitingForYou(conversation: InboxConversation): boolean {
  return waitingStatuses.includes(conversation.status)
}

export const inboxConversations: InboxConversation[] = [
  {
    id: 'cafe-4410',
    customerName: '[CAFE NAME]',
    contactDetail: '+62 812 •••• 4410 · from outreach',
    phoneNumber: '+62 812 •••• 4410',
    lastMessage: 'Oke deal 50 box, Jumat jam 11 ya',
    status: 'order-to-confirm',
    timeAgo: '2m',
    isFromOutreach: true,
    messages: [
      {
        id: 'm1',
        author: 'outreach-agent',
        time: '09:12',
        text: 'Halo tim [CAFE NAME], kami catering di Rajabasa dan ingin supply snack dan nasi box untuk cafe. Boleh saya kirim menunya?',
      },
      { id: 'm2', author: 'customer', text: 'Boleh kak, kebetulan Jumat ada acara kantor 50 orang' },
      {
        id: 'm3',
        author: 'bot',
        time: '09:20',
        text: 'Siap kak. Untuk 50 orang ada Paket Hemat [PRICE] dan Paket Komplit [PRICE] per box, ongkir gratis. Mau dikirim jam berapa?',
      },
      { id: 'm4', author: 'customer', text: 'Oke deal 50 box Paket Komplit, Jumat jam 11 ya' },
      { id: 'm5', author: 'notice', text: 'Bot handed this to you · order ready to confirm' },
    ],
    summary: {
      botSummary: 'Office event Friday, 50 people, wants Paket Komplit delivered at 11:00. Address still missing',
      orderRows: [
        { label: 'Order', value: '50 × Paket Komplit' },
        { label: 'Delivery', value: 'Fri 20 Nov · 11:00' },
        { label: 'Address', value: 'Missing', isMissing: true },
        { label: 'Lead score', value: '8 of 10' },
      ],
      cameFrom: 'Maps leads to WhatsApp, today 09:12',
    },
    suggestedReply: 'Siap kak, 50 Paket Komplit Jumat jam 11. Boleh minta alamat lengkapnya?',
  },
  {
    id: 'contact-0932',
    customerName: '+62 857 •••• 0932',
    contactDetail: 'new contact',
    phoneNumber: '+62 857 •••• 0932',
    lastMessage: 'Bisa ngobrol sama orangnya langsung?',
    status: 'asked-for-you',
    timeAgo: '9m',
    isFromOutreach: false,
    messages: [
      { id: 'm1', author: 'customer', text: 'Halo, mau tanya catering untuk arisan' },
      { id: 'm2', author: 'bot', time: '10:41', text: 'Halo kak, boleh. Untuk berapa orang dan tanggal berapa?' },
      { id: 'm3', author: 'customer', text: 'Bisa ngobrol sama orangnya langsung?' },
      { id: 'm4', author: 'notice', text: 'Bot handed this to you · customer asked for a person' },
    ],
    summary: {
      botSummary: 'Asking about catering for an arisan. Wants to talk to a person before sharing details',
      orderRows: [
        { label: 'Order', value: 'Not yet', isMissing: true },
        { label: 'Lead score', value: '5 of 10' },
      ],
      cameFrom: 'Messaged first, today 10:40',
    },
    suggestedReply: 'Halo kak, saya pemilik catering. Ada yang bisa saya bantu?',
  },
  {
    id: 'office-7781',
    customerName: '[OFFICE NAME]',
    contactDetail: '+62 813 •••• 7781 · from outreach',
    phoneNumber: '+62 813 •••• 7781',
    lastMessage: 'Ada menu khusus vegetarian?',
    status: 'bot-not-sure',
    timeAgo: '21m',
    isFromOutreach: true,
    messages: [
      { id: 'm1', author: 'outreach-agent', time: '08:55', text: 'Halo tim [OFFICE NAME], kami catering di Rajabasa. Boleh saya kirim menu nasi box kami?' },
      { id: 'm2', author: 'customer', text: 'Ada menu khusus vegetarian?' },
      { id: 'm3', author: 'notice', text: 'Bot handed this to you · answer not in the knowledge' },
    ],
    summary: {
      botSummary: 'Asked for vegetarian options. The menu does not mention any',
      orderRows: [
        { label: 'Order', value: 'Not yet', isMissing: true },
        { label: 'Lead score', value: '6 of 10' },
      ],
      cameFrom: 'Maps leads to WhatsApp, today 08:55',
    },
  },
  {
    id: 'returning-5520',
    customerName: '+62 821 •••• 5520',
    contactDetail: 'returning customer',
    phoneNumber: '+62 821 •••• 5520',
    lastMessage: 'Bot: Siap kak, alamatnya sama seperti kemarin ya?',
    status: 'bot-answering',
    timeAgo: '24m',
    isFromOutreach: false,
    messages: [
      { id: 'm1', author: 'customer', text: 'Pesan lagi 20 box Paket Hemat untuk besok ya kak' },
      { id: 'm2', author: 'bot', time: '10:26', text: 'Siap kak, alamatnya sama seperti kemarin ya?' },
    ],
  },
  {
    id: 'cafe-3018',
    customerName: '[CAFE NAME]',
    contactDetail: '+62 812 •••• 3018 · from outreach',
    phoneNumber: '+62 812 •••• 3018',
    lastMessage: 'Bot: Menu lengkapnya saya kirim di sini ya kak',
    status: 'bot-answering',
    timeAgo: '40m',
    isFromOutreach: true,
    messages: [
      { id: 'm1', author: 'customer', text: 'Boleh lihat menunya kak?' },
      { id: 'm2', author: 'bot', time: '10:10', text: 'Menu lengkapnya saya kirim di sini ya kak' },
    ],
  },
  {
    id: 'contact-2264',
    customerName: '+62 878 •••• 2264',
    contactDetail: 'new contact',
    phoneNumber: '+62 878 •••• 2264',
    lastMessage: 'Makasih infonya kak',
    status: 'closed',
    timeAgo: '1h',
    isFromOutreach: false,
    messages: [
      { id: 'm1', author: 'customer', text: 'Jam buka catering sampai jam berapa kak?' },
      { id: 'm2', author: 'bot', time: '09:31', text: 'Kami terima pesanan setiap hari jam 07:00 sampai 20:00 kak' },
      { id: 'm3', author: 'customer', text: 'Makasih infonya kak' },
    ],
  },
]

/** Today's totals across every chat, not only the rows shown. */
export const inboxStats = {
  chatsToday: 34,
  answeredByBot: 29,
  waitingForYou: 3,
  ordersCollected: 4,
  botAnswering: 8,
  fromOutreach: 11,
} as const

export function findConversation(conversationId: string | null): InboxConversation | undefined {
  return inboxConversations.find((conversation) => conversation.id === conversationId)
}
