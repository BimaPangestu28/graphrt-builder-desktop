import { messages } from '@/i18n'

/**
 * The customer channels the connect step offers, in display order. Each entry is one wide
 * card of the picker; its setup is chosen by `id` in `ConnectWhatsAppPage`. Adding a
 * channel is one entry here plus its setup component.
 */
export type ChannelOptionId = 'telegram' | 'business' | 'personal'

export interface ChannelOption {
  id: ChannelOptionId
  title: string
  description: string
  /** The chatbot setup's channel id (`whatsapp`, `whatsapp-web`, `telegram`) this option connects. */
  chatbotChannel: string
}

export function listChannelOptions(): ChannelOption[] {
  const t = messages().chatbot
  const c = messages().channels
  return [
    { id: 'telegram', title: c.telegramTitle, description: c.telegramDescription, chatbotChannel: 'telegram' },
    { id: 'business', title: t.businessTitle, description: t.businessDescription, chatbotChannel: 'whatsapp' },
    { id: 'personal', title: t.personalTitle, description: t.personalDescription, chatbotChannel: 'whatsapp-web' },
  ]
}

/** The option for `?channel=` (an option id, or a chatbot setup channel id), if any. */
export function findChannelOption(value: string | null): ChannelOptionId | null {
  if (!value) return null
  const option = listChannelOptions().find((candidate) => candidate.id === value || candidate.chatbotChannel === value)
  return option?.id ?? null
}
