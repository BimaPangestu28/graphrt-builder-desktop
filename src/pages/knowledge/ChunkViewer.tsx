import { useState } from 'react'
import type { KnowledgeChunk, KnowledgeDocument } from '@/api/knowledgeTypes'
import { KNOWLEDGE_CHUNK_PAGE_SIZE } from '@/api/knowledge'
import { useKnowledgeChunks } from '@/hooks/useKnowledgeChunks'
import { joinClassNames } from '@/components/ui'
import { compactButtonClassNames } from './FormControls'
import { SearchFieldIcon } from './PassageMatch'
import { formatNumber, useT } from '@/i18n'

/** Passages longer than this are shown shortened until "Show full text". */
const PREVIEW_CHARS = 280

function chunkFacts(chunk: KnowledgeChunk, t: ReturnType<typeof useT>['knowledgeIndexing']): string[] {
  const facts = [t.tokens(formatNumber(chunk.tokenCount)), t.characters(formatNumber(chunk.charCount))]
  if (chunk.pages.length > 0) facts.push(t.page(chunk.pages.join(', ')))
  else if (chunk.charStart !== null && chunk.charEnd !== null) facts.push(t.characterRange(formatNumber(chunk.charStart), formatNumber(chunk.charEnd)))
  return facts
}

/** One passage card: number, size, where it is, and its text (shortened until expanded). */
function ChunkCard({ chunk }: { chunk: KnowledgeChunk }) {
  const t = useT().knowledgeIndexing
  const [isExpanded, setIsExpanded] = useState(false)
  const isLong = chunk.text.length > PREVIEW_CHARS
  const shownText = isExpanded || !isLong ? chunk.text : `${chunk.text.slice(0, PREVIEW_CHARS).trimEnd()}…`
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4" aria-label={t.passageLabel(formatNumber(chunk.index + 1))}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-inverse">#{formatNumber(chunk.index + 1)}</span>
        {chunk.heading && <span className="min-w-0 truncate text-[12px] font-medium text-ink-2" title={chunk.heading}>{chunk.heading}</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {chunkFacts(chunk, t).map((fact) => (
            <span key={fact} className="rounded-full bg-chip px-2 py-0.5 text-[11px] whitespace-nowrap text-ink-2">
              {fact}
            </span>
          ))}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-relaxed break-words whitespace-pre-line text-body">{shownText}</p>
      {isLong && (
        <button type="button" onClick={() => setIsExpanded((current) => !current)} className="cursor-pointer self-start border-0 bg-transparent p-0 text-[12px] font-medium text-brand-strong hover:underline">
          {isExpanded ? t.showLess : t.showFullText}
        </button>
      )}
    </li>
  )
}

interface ChunkViewerProps {
  document: KnowledgeDocument
  /** Changes when the knowledge base was indexed again, to reload the passages. */
  refreshKey: string
}

/**
 * The passages of one document, a page of {@link KNOWLEDGE_CHUNK_PAGE_SIZE} at a time, with a word
 * filter. Only the visible page is loaded, so documents with thousands of passages stay fast.
 */
export function ChunkViewer({ document, refreshKey }: ChunkViewerProps) {
  const t = useT().knowledgeIndexing
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const { page, isLoading, error } = useKnowledgeChunks(document, filter, offset, refreshKey)
  const matching = page?.matching ?? 0
  const firstShown = matching === 0 ? 0 : (page?.offset ?? 0) + 1
  const lastShown = (page?.offset ?? 0) + (page?.chunks.length ?? 0)

  return (
    <section aria-labelledby="chunks-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id="chunks-h" className="m-0 truncate text-[15px] font-semibold" title={document.name}>
            {t.passagesOf(document.name)}
          </h3>
          {page && <span className="text-[12px] text-muted">{t.documentTotals(formatNumber(page.totalTokens), formatNumber(page.totalChars))}</span>}
        </div>
        <label className="box-border flex h-10 w-full max-w-[320px] items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3 focus-within:border-brand">
          <SearchFieldIcon />
          <input
            type="search"
            aria-label={t.filterLabel}
            value={filter}
            placeholder={t.filterPlaceholder}
            onChange={(event) => {
              setFilter(event.target.value)
              setOffset(0)
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none"
          />
        </label>
      </div>

      {error && <p role="alert" className="m-0 text-[13px] text-danger">{t.couldNotLoadPassages(error.message)}</p>}
      {!page && isLoading && <p className="m-0 text-[13px] text-muted">{t.loadingPassages}</p>}
      {page && filter.trim() !== '' && !isLoading && <p className="m-0 text-[12px] text-muted" aria-live="polite">{t.matchingOf(formatNumber(page.matching), formatNumber(page.total))}</p>}
      {page && page.matching === 0 && filter.trim() !== '' && (
        <p className="m-0 rounded-[10px] border border-line bg-subtle px-3.5 py-3 text-[13px] text-muted">{t.noPassagesMatch}</p>
      )}
      {page && page.chunks.length > 0 && (
        <ol className={joinClassNames('m-0 grid list-none grid-cols-1 items-start gap-3 p-0 xl:grid-cols-2', isLoading && 'opacity-60')}>
          {page.chunks.map((chunk) => (
            <ChunkCard key={chunk.id} chunk={chunk} />
          ))}
        </ol>
      )}
      {page && matching > KNOWLEDGE_CHUNK_PAGE_SIZE && (
        <nav aria-label={t.passagesOf(document.name)} className="flex items-center justify-between gap-3">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - KNOWLEDGE_CHUNK_PAGE_SIZE, 0))} className={compactButtonClassNames('secondary')}>
            {t.previousPage}
          </button>
          <span className="text-[12px] text-muted">{t.showingRange(formatNumber(firstShown), formatNumber(lastShown), formatNumber(matching))}</span>
          <button type="button" disabled={lastShown >= matching} onClick={() => setOffset(offset + KNOWLEDGE_CHUNK_PAGE_SIZE)} className={compactButtonClassNames('secondary')}>
            {t.nextPage}
          </button>
        </nav>
      )}
    </section>
  )
}
