import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import type { AgentVersion } from '@/data/versionHistory'
import { routePaths } from '@/routes'
import { diffAgentSteps } from './version-history/diffAgentSteps'
import { StepDiffList } from './version-history/StepDiffList'
import { useVersionHistory, type ChangeNotice } from './version-history/useVersionHistory'
import { VersionHistoryList } from './version-history/VersionHistoryList'

const headerButtonBaseClassNames = 'inline-flex h-9 cursor-pointer items-center rounded-lg px-3.5 font-sans text-[13px] font-medium no-underline'
const secondaryHeaderButtonClassNames = `${headerButtonBaseClassNames} border border-line-strong bg-surface !text-ink hover:bg-subtle`

interface VersionHeaderProps {
  agentName: string
  selectedVersion: AgentVersion
  isViewingCurrent: boolean
  onShowCurrent: () => void
  onRestore: () => void
}

function VersionHeader({ agentName, selectedVersion, isViewingCurrent, onShowCurrent, onRestore }: VersionHeaderProps) {
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2.5">
        <Link to={routePaths.builder} className="text-[16px] font-semibold no-underline !text-ink">
          {agentName}
        </Link>
        <span className="rounded-full bg-selected px-2 py-[3px] text-[12px] font-medium text-ink-2">
          Viewing v{selectedVersion.number}
          {isViewingCurrent && ' · current'}
        </span>
      </div>
      <div className="flex gap-2">
        {isViewingCurrent ? (
          <Link to={routePaths.builder} className={secondaryHeaderButtonClassNames}>
            Back to steps
          </Link>
        ) : (
          <button type="button" onClick={onShowCurrent} className={secondaryHeaderButtonClassNames}>
            Back to current
          </button>
        )}
        <button
          type="button"
          onClick={onRestore}
          disabled={isViewingCurrent}
          className={`${headerButtonBaseClassNames} border-0 bg-ink text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Restore v{selectedVersion.number}
        </button>
      </div>
    </header>
  )
}

interface RestorePreviewProps {
  currentVersion: AgentVersion
  selectedVersion: AgentVersion
  nextVersionNumber: number
}

function RestorePreview({ currentVersion, selectedVersion, nextVersionNumber }: RestorePreviewProps) {
  const isViewingCurrent = currentVersion.number === selectedVersion.number
  const diffRows = diffAgentSteps(currentVersion.steps, selectedVersion.steps)

  return (
    <section aria-labelledby="restore-preview-heading" className="box-border flex min-w-0 flex-[3_1_480px] flex-col gap-4 px-8 py-7">
      <div className="flex flex-col gap-1">
        <h1 id="restore-preview-heading" className="m-0 text-[18px] font-semibold">
          {isViewingCurrent ? `v${currentVersion.number} is the current version` : `What changes if you restore v${selectedVersion.number}`}
        </h1>
        <span className="text-body">
          {isViewingCurrent
            ? 'Pick an older version in History to compare it'
            : `Compared with the current version, v${currentVersion.number}`}
        </span>
      </div>
      <StepDiffList rows={diffRows} />
      <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-3 leading-normal text-body">
        Runs already in progress keep the version they started with. Restoring creates v{nextVersionNumber}, so you can always come back
      </p>
    </section>
  )
}

function ChangeToast({ changeNotice, onUndo }: { changeNotice: ChangeNotice; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-ink py-3 pr-3 pl-[18px] text-white shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
    >
      <span>{changeNotice.message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="h-8 cursor-pointer rounded-lg border-0 bg-surface px-3 font-sans text-[13px] font-semibold text-ink"
      >
        Undo
      </button>
    </div>
  )
}

/**
 * Screen 24 · Version history for "Maps leads to WhatsApp".
 * Pick a version in History to see, step by step, what restoring it would remove or change
 * compared with the current one. Restore adds a new version on top; the toast's Undo
 * takes back the latest change. All state is local.
 */
export function VersionHistoryPage() {
  const versionHistory = useVersionHistory()
  const { currentVersion, selectedVersion, changeNotice } = versionHistory
  const isViewingCurrent = selectedVersion.number === currentVersion.number

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'maps-leads' }} mainClassName="flex flex-col">
      <VersionHeader
        agentName="Maps leads to WhatsApp"
        selectedVersion={selectedVersion}
        isViewingCurrent={isViewingCurrent}
        onShowCurrent={versionHistory.showCurrentVersion}
        onRestore={versionHistory.restoreSelectedVersion}
      />
      <div className="flex flex-auto flex-wrap">
        <RestorePreview currentVersion={currentVersion} selectedVersion={selectedVersion} nextVersionNumber={versionHistory.nextVersionNumber} />
        <VersionHistoryList
          versions={versionHistory.versions}
          currentVersionNumber={currentVersion.number}
          selectedVersionNumber={selectedVersion.number}
          onSelectVersion={versionHistory.selectVersion}
        />
      </div>
      {changeNotice && <ChangeToast changeNotice={changeNotice} onUndo={versionHistory.undoLastChange} />}
    </AppShell>
  )
}
