import type { KnowledgeBase, KnowledgePassage, KnowledgeSource } from '@/api/knowledgeTypes'
import { detectSourceType } from './SourceTypeTile'
import { connectorTileType, connectorUpdateText, type ConnectorTileType } from './connectors/connectorDisplay'
import { formatNumber, messages } from '@/i18n'

/** File type badge of a knowledge source: PDF, spreadsheet, text, web page, or a connector. */
export type KnowledgeSourceType = 'PDF' | 'XLS' | 'TXT' | ConnectorTileType

/**
 * Turns knowledge records into the words and labels screens 17 and 18 show.
 */

/** Tile type of a source: WEB for links, otherwise from the file extension (folders are TXT). */
export function sourceTileType(source: Pick<KnowledgeSource, 'kind' | 'name' | 'connector'>): KnowledgeSourceType {
  if (source.connector) return connectorTileType(source.connector.kind)
  if (source.kind === 'url') return 'WEB'
  return source.kind === 'folder' ? 'TXT' : detectSourceType(source.name)
}

/** "When the file changes" style text for the Updates column. */
export function sourceUpdateText(source: Pick<KnowledgeSource, 'kind' | 'connector'>): string {
  if (source.connector) return connectorUpdateText(source.connector)
  const t = messages().knowledge
  if (source.kind === 'url') return t.whenYouSync
  return source.kind === 'folder' ? t.whenFolderChanges : t.whenFileChanges
}

/** Second line under a source name: file count for folders, page count for links. */
export function sourceDetailText(source: KnowledgeSource): string | undefined {
  if (source.connector) {
    const account = source.connector.accountLabel
    const noun = source.connector.kind === 'website' || source.connector.kind === 'notion' ? 'page' : 'file'
    const count = source.documentCount > 0 ? pluralize(source.documentCount, noun) : undefined
    return [count, account].filter(Boolean).join(' · ') || undefined
  }
  if (source.kind === 'folder') return pluralize(source.documentCount, 'file')
  if (source.kind === 'url' && source.documentCount > 1) return pluralize(source.documentCount, 'page')
  return undefined
}

/**
 * "1 file", "3 files".
 *
 * @example
 * pluralize(412, 'passage') // "412 passages"
 */
export type CountedNoun = 'file' | 'page' | 'website' | 'passage'

/** "1 file", "1,234 passages" / "1.234 potongan teks", in the current language. */
export function pluralize(count: number, noun: CountedNoun): string {
  const t = messages().knowledge
  const countText = formatNumber(count)
  const isOne = count === 1
  switch (noun) {
    case 'file':
      return t.files(countText, isOne)
    case 'page':
      return t.pages(countText, isOne)
    case 'website':
      return t.websites(countText, isOne)
    case 'passage':
      return t.passages(countText, isOne)
  }
}

/** Grey chips on a knowledge base card: files, websites, passages. */
export function knowledgeBaseFacts(knowledgeBase: KnowledgeBase): string[] {
  if (knowledgeBase.sourceCount === 0) return [messages().knowledge.noSourcesYet]
  const facts: string[] = []
  if (knowledgeBase.fileCount > 0) facts.push(pluralize(knowledgeBase.fileCount, 'file'))
  if (knowledgeBase.websiteCount > 0) facts.push(pluralize(knowledgeBase.websiteCount, 'website'))
  facts.push(pluralize(knowledgeBase.passageCount, 'passage'))
  return facts
}

/** Percent of sources done in a running sync, 0 when unknown. */
export function syncPercent(knowledgeBase: KnowledgeBase): number {
  const progress = knowledgeBase.syncProgress
  if (!progress || progress.total === 0) return 0
  return Math.round((progress.done / progress.total) * 100)
}

/** "9.4 MB" (one decimal, at least 0.1 MB once anything is stored). */
export function formatMegabytes(byteCount: number): string {
  const megabytes = byteCount / 1_000_000
  if (byteCount > 0 && megabytes < 0.1) return `${formatNumber(0.1, { minimumFractionDigits: 1 })} MB`
  return `${formatNumber(megabytes, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

/** Local "13:02" for an RFC 3339 time, "never" for null. */
export function formatClockTime(timestamp: string | null): string {
  if (!timestamp) return messages().knowledge.never
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "Delivery and FAQ · page 11 · Catering menu and prices" line under a passage. */
export function passageCitation(passage: KnowledgePassage): string {
  return [passage.sourceName, passage.location, passage.knowledgeBaseName].filter(Boolean).join(' · ')
}
