import { useState } from 'react'
import type { ChunkingSettings, KnowledgeBaseDetail, KnowledgeDocument } from '@/api/knowledgeTypes'
import { useKnowledgeDocuments } from '@/hooks/useKnowledgeChunks'
import { joinClassNames } from '@/components/ui'
import { ChunkViewer } from './ChunkViewer'
import { ChunkingSettingsCard } from './ChunkingSettingsCard'
import { compactButtonClassNames } from './FormControls'
import { formatClockTime, syncPercent } from './knowledgeDisplay'
import { formatDateTime, formatNumber, messages, useT } from '@/i18n'

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="truncate text-[17px] font-semibold text-ink" title={value}>
        {value}
      </span>
    </div>
  )
}

function indexedAtText(document: KnowledgeDocument): string {
  const t = messages().knowledgeIndexing
  if (!document.indexedAt) return t.indexedAtUnknown
  return t.indexedAt(formatDateTime(new Date(document.indexedAt), { dateStyle: 'medium', timeStyle: 'short' }))
}

interface ReindexBannerProps {
  detail: KnowledgeBaseDetail
  onReindex: () => void
}

/** Shown while documents were cut with older settings, with "Index again" and its progress. */
function ReindexBanner({ detail, onReindex }: ReindexBannerProps) {
  const t = useT().knowledgeIndexing
  const { knowledgeBase } = detail
  const isSyncing = knowledgeBase.status === 'syncing'
  const progress = knowledgeBase.syncProgress
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-line bg-amber-tint px-5 py-4">
      <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-amber-deep">{t.reindexNeededTitle}</span>
        <span className="text-[13px] leading-snug text-amber-deep">{t.reindexNeededHint}</span>
      </span>
      {isSyncing && progress && (
        <span className="flex min-w-[180px] flex-col gap-1">
          <span className="text-[12px] text-amber-deep">{t.reindexProgress(Math.min(progress.done + 1, progress.total), progress.total)}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-amber-soft">
            <span className="block h-full rounded-full bg-amber-strong" style={{ width: `${syncPercent(knowledgeBase)}%` }} />
          </span>
        </span>
      )}
      <button type="button" disabled={isSyncing} onClick={onReindex} className={compactButtonClassNames('primary')}>
        {isSyncing ? t.reindexing : t.reindex}
      </button>
    </div>
  )
}

interface KnowledgeIndexingTabProps {
  detail: KnowledgeBaseDetail
  onReindex: () => void
  onSaveChunking: (chunking: ChunkingSettings) => Promise<boolean>
}

/**
 * The "Indexing results" tab of screen 18: totals, the documents and their passages
 * (paged, filterable), and the chunking settings under "Advanced settings".
 */
export function KnowledgeIndexingTab({ detail, onReindex, onSaveChunking }: KnowledgeIndexingTabProps) {
  const t = useT().knowledgeIndexing
  const { knowledgeBase, sources } = detail
  const { documents, isLoading, error } = useKnowledgeDocuments(sources)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosen = documents.find((document) => `${document.sourceId}\n${document.documentId}` === chosenId) ?? documents[0] ?? null
  const embedding = knowledgeBase.settings.embedding === 'openai' ? t.embeddingOpenai : t.embeddingLocal
  const refreshKey = `${knowledgeBase.lastSyncedAt ?? ''}:${chosen?.indexedAt ?? ''}:${chosen?.passageCount ?? 0}`

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t.statPassages} value={formatNumber(knowledgeBase.passageCount)} />
        <StatCard label={t.statDocuments} value={formatNumber(documents.length)} />
        <StatCard label={t.statPassageSize} value={t.statPassageSizeValue(formatNumber(knowledgeBase.settings.chunking.maxTokens))} />
        <StatCard label={t.statEmbedding} value={embedding} />
      </div>

      {knowledgeBase.needsReindex && <ReindexBanner detail={detail} onReindex={onReindex} />}

      <ChunkingSettingsCard chunking={knowledgeBase.settings.chunking} onSave={onSaveChunking} />

      {error && <p role="alert" className="m-0 text-[13px] text-danger">{t.couldNotLoadDocuments(error.message)}</p>}
      {!error && isLoading && documents.length === 0 && <p className="m-0 text-[13px] text-muted">{t.loadingDocuments}</p>}
      {!error && !isLoading && documents.length === 0 && (
        <p className="m-0 rounded-2xl border border-line bg-subtle px-5 py-4 text-[13px] text-muted">{t.noDocuments}</p>
      )}
      {documents.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
          <section aria-labelledby="docs-h" className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <h3 id="docs-h" className="m-0 text-[15px] font-semibold">
                {t.documents}
              </h3>
              <span className="text-[12px] text-muted">{t.documentsHint}</span>
            </div>
            <ul className="m-0 flex max-h-[640px] list-none flex-col gap-2 overflow-y-auto p-0">
              {documents.map((document) => {
                const id = `${document.sourceId}\n${document.documentId}`
                const isChosen = chosen !== null && `${chosen.sourceId}\n${chosen.documentId}` === id
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={isChosen}
                      onClick={() => setChosenId(id)}
                      className={joinClassNames(
                        'flex w-full cursor-pointer flex-col gap-1 rounded-xl border px-3.5 py-3 text-left',
                        isChosen ? 'border-ink bg-surface shadow-sm' : 'border-line bg-surface hover:border-line-heavy',
                      )}
                    >
                      <span className="truncate text-[13px] font-medium text-ink" title={document.name}>
                        {document.name}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <span>{t.documentPassages(formatNumber(document.passageCount))}</span>
                        {document.needsReindex && <span className="rounded-full bg-amber-soft px-1.5 text-[11px] font-semibold text-amber-strong">{t.documentNeedsReindex}</span>}
                      </span>
                      <span className="truncate text-[11px] text-faint">{indexedAtText(document)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
          {chosen && <ChunkViewer key={`${chosen.sourceId}\n${chosen.documentId}`} document={chosen} refreshKey={refreshKey} />}
        </div>
      )}
      <p className="m-0 text-[12px] text-muted">
        {t.statLastIndexed}: {formatClockTime(knowledgeBase.lastSyncedAt)}
      </p>
    </div>
  )
}
