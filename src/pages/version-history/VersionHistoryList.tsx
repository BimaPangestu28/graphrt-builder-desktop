import { joinClassNames } from '@/components/ui'
import { draftVersionsGroup, type AgentVersion } from '@/data/versionHistory'

const cardClassNames = 'flex w-full flex-col gap-1 rounded-[10px] bg-surface text-left font-sans text-[14px] text-ink'

function VersionCardBody({ title, savedAt, summary, origin }: { title: string; savedAt: string; summary: string; origin?: string }) {
  return (
    <>
      <span className="flex justify-between gap-2">
        <b className="font-semibold">{title}</b>
        <span className="text-[12px] text-muted">{savedAt}</span>
      </span>
      <span className="text-[13px] text-ink-2">{summary}</span>
      {origin && <span className="text-[12px] text-muted">{origin}</span>}
    </>
  )
}

interface VersionHistoryListProps {
  versions: AgentVersion[]
  currentVersionNumber: number
  selectedVersionNumber: number
  onSelectVersion: (versionNumber: number) => void
}

/** Right column of screen 24: every saved version, newest first; click one to preview it. */
export function VersionHistoryList({ versions, currentVersionNumber, selectedVersionNumber, onSelectVersion }: VersionHistoryListProps) {
  return (
    <aside
      aria-labelledby="version-history-heading"
      className="box-border flex min-w-0 flex-[1_1_320px] flex-col gap-3 border-l border-line bg-subtle p-6"
    >
      <h2 id="version-history-heading" className="m-0 text-[15px] font-semibold">
        History
      </h2>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {versions.map((version) => {
          const isSelected = version.number === selectedVersionNumber
          const isCurrent = version.number === currentVersionNumber
          return (
            <li key={version.number}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectVersion(version.number)}
                className={joinClassNames(
                  cardClassNames,
                  'cursor-pointer',
                  isSelected ? 'border-2 border-ink px-[13px] py-[11px]' : 'border border-line px-3.5 py-3 hover:border-line-heavy',
                )}
              >
                <VersionCardBody
                  title={isCurrent ? `v${version.number} · current` : `v${version.number}`}
                  savedAt={version.savedAt}
                  summary={version.summary}
                  origin={version.origin}
                />
              </button>
            </li>
          )
        })}
        <li className={joinClassNames(cardClassNames, 'border border-line px-3.5 py-3')}>
          <VersionCardBody title={draftVersionsGroup.label} savedAt={draftVersionsGroup.savedAt} summary={draftVersionsGroup.summary} />
        </li>
      </ol>
    </aside>
  )
}
