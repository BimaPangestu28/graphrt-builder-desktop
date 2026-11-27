import type { FileCard, FileCardKind } from '@/api/agentFileTypes'
import { readFileCards } from '@/api/agentFileTypes'
import type { ConversationMessage } from '@/api/conversationTypes'
import type { IconName } from '@/components/ui'
import { formatNumber, messages } from '@/i18n'

const bytesPerKilobyte = 1024
const bytesPerMegabyte = 1024 * 1024

/**
 * A file size in the unit a person reads: bytes below 1 KB, then KB, then MB. One decimal below 10.
 *
 * @param sizeBytes - Size in bytes (number)
 * @returns e.g. "512 B", "1.2 KB", "184 KB", "3.4 MB" (string)
 *
 * @example
 * formatFileSize(184_320) // "180 KB"
 */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < bytesPerKilobyte) return messages().files.sizeBytes(Math.max(0, Math.round(sizeBytes)))
  const inUnit = (amount: number) => formatNumber(amount, { maximumFractionDigits: amount < 10 ? 1 : 0 })
  if (sizeBytes < bytesPerMegabyte) return messages().files.sizeKilobytes(inUnit(sizeBytes / bytesPerKilobyte))
  return messages().files.sizeMegabytes(inUnit(sizeBytes / bytesPerMegabyte))
}

/** The line under a file's name: its kind and size, e.g. "PDF · 180 KB". */
export function fileMetaLine(card: FileCard): string {
  return `${messages().files.kindNames[card.kind]} · ${formatFileSize(card.sizeBytes)}`
}

const iconsByKind: Record<FileCardKind, IconName> = {
  picture: 'image',
  pdf: 'file',
  document: 'file',
  spreadsheet: 'table',
  slides: 'monitor',
  text: 'file',
  web_page: 'file',
  other: 'file',
}

/** The icon of a file kind, shown when the card has no picture preview. */
export function fileKindIcon(kind: FileCardKind): IconName {
  return iconsByKind[kind]
}

/** The files of one chat message, read from its metadata. */
export interface MessageFileCards {
  /** What the customer attached (`metadata.attachments`). */
  attachments: FileCard[]
  /** What the bot's reply hands back (`metadata.files`). */
  files: FileCard[]
  /** The message's text is only the names of its files, so the chat shows the cards alone. */
  isFilesOnly: boolean
}

/**
 * Reads the file cards a chat message carries.
 *
 * @param message - A stored chat message (ConversationMessage)
 * @returns Its attachments, its files and whether it has no text of its own (MessageFileCards)
 */
export function readMessageFiles(message: ConversationMessage): MessageFileCards {
  const attachments = readFileCards(message.metadata.attachments)
  const files = readFileCards(message.metadata.files)
  return { attachments, files, isFilesOnly: message.metadata.filesOnly === true && attachments.length + files.length > 0 }
}
