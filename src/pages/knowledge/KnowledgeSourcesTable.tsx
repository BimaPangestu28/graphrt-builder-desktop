import { joinClassNames } from '@/components/ui'
import type { KnowledgeSource, KnowledgeSourceStatus } from '@/data/knowledge'
import { SourceTypeTile } from './SourceTypeTile'

function SourceStatusPill({ status }: { status: KnowledgeSourceStatus }) {
  const statusStyles: Record<KnowledgeSourceStatus['kind'], string> = {
    ready: 'bg-ok-soft text-ok-strong',
    warning: 'bg-amber-soft text-amber-strong',
    reading: 'bg-brand-soft text-brand-strong',
  }
  const label = status.kind === 'ready' ? 'Ready' : status.kind === 'warning' ? status.label : `Reading… ${status.percent}%`
  return <span className={joinClassNames('rounded-full px-2 py-[3px] font-medium whitespace-nowrap', statusStyles[status.kind])}>{label}</span>
}

const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'

/** Table of the files and websites inside a knowledge base (screen 18). */
export function KnowledgeSourcesTable({ sources }: { sources: KnowledgeSource[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className={headerCellClassNames}>Source</th>
            <th className={headerCellClassNames}>Passages</th>
            <th className={headerCellClassNames}>Updates</th>
            <th className={headerCellClassNames}>Status</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source, index) => {
            const cellClassNames = joinClassNames('px-4 py-3', index < sources.length - 1 && 'border-b border-chip')
            return (
              <tr key={source.id}>
                <td className={cellClassNames}>
                  <span className="flex items-center gap-2.5">
                    <SourceTypeTile type={source.type} size="sm" />
                    <span className="flex flex-col">
                      <span className="font-medium">{source.name}</span>
                      {source.detail && <span className="text-[12px] text-muted">{source.detail}</span>}
                    </span>
                  </span>
                </td>
                <td className={joinClassNames(cellClassNames, 'text-ink-2')}>{source.passages}</td>
                <td className={joinClassNames(cellClassNames, 'text-ink-2')}>{source.updates}</td>
                <td className={cellClassNames}>
                  <SourceStatusPill status={source.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
