import { Icon, joinClassNames } from '@/components/ui'
import type { KnowledgeSource } from '@/api/knowledgeTypes'
import { SourceTypeTile } from './SourceTypeTile'
import { sourceDetailText, sourceTileType, sourceUpdateText } from './knowledgeDisplay'

type StatusTone = 'ready' | 'warning' | 'reading' | 'failed' | 'pending'

const statusToneClassNames: Record<StatusTone, string> = {
  ready: 'bg-ok-soft text-ok-strong',
  warning: 'bg-amber-soft text-amber-strong',
  reading: 'bg-brand-soft text-brand-strong',
  failed: 'bg-danger-soft text-danger',
  pending: 'bg-canvas text-ink-2',
}

function describeStatus(source: KnowledgeSource, readingPercent: number | undefined): { tone: StatusTone; label: string } {
  switch (source.status) {
    case 'pending':
      return { tone: 'pending', label: 'Waiting' }
    case 'reading':
      return { tone: 'reading', label: readingPercent ? `Reading… ${readingPercent}%` : 'Reading…' }
    case 'failed':
      return { tone: 'failed', label: 'Failed' }
    case 'indexed':
      return source.failedCount > 0 ? { tone: 'warning', label: source.statusMessage ?? 'Some files failed' } : { tone: 'ready', label: 'Ready' }
  }
}

function SourceStatusPill({ source, readingPercent }: { source: KnowledgeSource; readingPercent?: number }) {
  const { tone, label } = describeStatus(source, readingPercent)
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={joinClassNames('rounded-full px-2 py-[3px] font-medium whitespace-nowrap', statusToneClassNames[tone])}>{label}</span>
      {source.status === 'failed' && source.statusMessage && <span className="max-w-[260px] text-[12px] text-danger">{source.statusMessage}</span>}
    </span>
  )
}

const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'

interface KnowledgeSourcesTableProps {
  sources: KnowledgeSource[]
  /** Live reading progress by source id, from `knowledge-event`s. */
  readingPercents?: Record<string, number>
  onRemove: (source: KnowledgeSource) => void
}

/** Table of the files, folders and websites inside a knowledge base (screen 18). */
export function KnowledgeSourcesTable({ sources, readingPercents = {}, onRemove }: KnowledgeSourcesTableProps) {
  if (sources.length === 0) {
    return <p className="m-0 rounded-xl border border-dashed border-line-heavy bg-subtle px-4 py-6 text-center text-[13px] text-muted">No sources yet. Add files, a folder or a link</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className={headerCellClassNames}>Source</th>
            <th className={headerCellClassNames}>Passages</th>
            <th className={headerCellClassNames}>Updates</th>
            <th className={headerCellClassNames}>Status</th>
            <th className={headerCellClassNames}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source, index) => {
            const cellClassNames = joinClassNames('px-4 py-3', index < sources.length - 1 && 'border-b border-chip')
            const detailText = sourceDetailText(source)
            const isBusy = source.status === 'reading' || source.status === 'pending'
            return (
              <tr key={source.id}>
                <td className={cellClassNames}>
                  <span className="flex items-center gap-2.5">
                    <SourceTypeTile type={sourceTileType(source)} size="sm" />
                    <span className="flex flex-col">
                      <span className="font-medium" title={source.location}>
                        {source.name}
                      </span>
                      {detailText && <span className="text-[12px] text-muted">{detailText}</span>}
                    </span>
                  </span>
                </td>
                <td className={joinClassNames(cellClassNames, 'text-ink-2')}>{isBusy && source.passageCount === 0 ? '…' : source.passageCount.toLocaleString('en-US')}</td>
                <td className={joinClassNames(cellClassNames, 'text-ink-2')}>{sourceUpdateText(source)}</td>
                <td className={cellClassNames}>
                  <SourceStatusPill source={source} readingPercent={readingPercents[source.id]} />
                </td>
                <td className={joinClassNames(cellClassNames, 'text-right')}>
                  <button
                    type="button"
                    aria-label={`Remove ${source.name}`}
                    onClick={() => onRemove(source)}
                    className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-subtle hover:text-ink"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
