import { joinClassNames } from '@/components/ui'
import type { KnowledgeSourceType } from './knowledgeDisplay'

const sourceTypeClassNames: Record<KnowledgeSourceType, string> = {
  PDF: 'bg-danger-soft text-danger',
  XLS: 'bg-ok-soft text-ok-strong',
  TXT: 'bg-selected text-ink-2',
  WEB: 'bg-info-soft text-info',
  API: 'bg-selected text-ink',
  GD: 'bg-amber-soft text-amber-strong',
  N: 'bg-ink text-inverse',
  SP: 'bg-brand-soft text-brand-strong',
}

/**
 * Small colored square naming a knowledge source's file type (PDF, XLS, TXT, WEB) or its
 * connector (API, GD for Google Drive, N for Notion, SP for SharePoint).
 * Used in the chatbot setup knowledge list (32px) and the knowledge sources table (30px).
 */
export function SourceTypeTile({ type, size = 'md' }: { type: KnowledgeSourceType; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={joinClassNames(
        'flex shrink-0 items-center justify-center rounded-lg text-[10px] font-bold',
        size === 'md' ? 'size-8' : 'size-[30px]',
        sourceTypeClassNames[type],
      )}
    >
      {type}
    </span>
  )
}

/**
 * Picks a tile type from a file name, for files the user adds during the session.
 *
 * @param fileName - e.g. "Menu December.pdf"
 * @returns The matching source type, TXT when unknown
 */
export function detectSourceType(fileName: string): KnowledgeSourceType {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'pdf') return 'PDF'
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'XLS'
  return 'TXT'
}
