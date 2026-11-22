import type { KnowledgeBase, KnowledgePassage, KnowledgeSource } from '@/api/knowledgeTypes'
import { detectSourceType } from './SourceTypeTile'

/** File type badge of a knowledge source: PDF, spreadsheet, text or web page. */
export type KnowledgeSourceType = 'PDF' | 'XLS' | 'TXT' | 'WEB'

/**
 * Turns knowledge records into the words and labels screens 17 and 18 show.
 */

/** Tile type of a source: WEB for links, otherwise from the file extension (folders are TXT). */
export function sourceTileType(source: Pick<KnowledgeSource, 'kind' | 'name'>): KnowledgeSourceType {
  if (source.kind === 'url') return 'WEB'
  return source.kind === 'folder' ? 'TXT' : detectSourceType(source.name)
}

/** "When the file changes" style text for the Updates column. */
export function sourceUpdateText(source: Pick<KnowledgeSource, 'kind'>): string {
  if (source.kind === 'url') return 'When you sync'
  return source.kind === 'folder' ? 'When the folder changes' : 'When the file changes'
}

/** Second line under a source name: file count for folders, page count for links. */
export function sourceDetailText(source: KnowledgeSource): string | undefined {
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
export function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
}

/** Grey chips on a knowledge base card: files, websites, passages. */
export function knowledgeBaseFacts(knowledgeBase: KnowledgeBase): string[] {
  if (knowledgeBase.sourceCount === 0) return ['No sources yet']
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
  if (byteCount > 0 && megabytes < 0.1) return '0.1 MB'
  return `${megabytes.toFixed(1)} MB`
}

/** Local "13:02" for an RFC 3339 time, "never" for null. */
export function formatClockTime(timestamp: string | null): string {
  if (!timestamp) return 'never'
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "Delivery and FAQ · page 11 · Catering menu and prices" line under a passage. */
export function passageCitation(passage: KnowledgePassage): string {
  return [passage.sourceName, passage.location, passage.knowledgeBaseName].filter(Boolean).join(' · ')
}
