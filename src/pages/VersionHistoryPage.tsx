import { Link, useParams } from 'react-router-dom'
import type { VersionComparison, VersionSteps } from '@/api/versionTypes'
import { AppShell } from '@/components/layout'
import { useAgent } from '@/hooks/useAgent'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, sampleAgentId } from '@/routes'
import { StepDiffList } from './version-history/StepDiffList'
import { toStepDiffRows } from './version-history/stepDiffRows'
import { useVersionHistory, type ChangeNotice, type VersionEntry } from './version-history/useVersionHistory'
import { VersionHistoryList } from './version-history/VersionHistoryList'
import { messages } from '@/i18n'

const headerButtonBaseClassNames = 'inline-flex h-9 cursor-pointer items-center rounded-lg px-3.5 font-sans text-[13px] font-medium no-underline'
const secondaryHeaderButtonClassNames = `${headerButtonBaseClassNames} border border-line-strong bg-surface !text-ink hover:bg-subtle`

interface VersionHeaderProps {
  agentId: string
  agentName: string
  selectedVersion: VersionEntry
  isViewingCurrent: boolean
  isRestoring: boolean
  onShowCurrent: () => void
  onRestore: () => void
}

function VersionHeader({ agentId, agentName, selectedVersion, isViewingCurrent, isRestoring, onShowCurrent, onRestore }: VersionHeaderProps) {
  const builderPath = agentPath('builder', agentId)
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-8 py-3">
      <div className="flex items-center gap-2.5">
        <Link to={builderPath} className="text-[16px] font-semibold no-underline !text-ink">
          {agentName}
        </Link>
        <span className="rounded-full bg-selected px-2 py-[3px] text-[12px] font-medium text-ink-2">
          {messages().misc.viewingV}{selectedVersion.number}
          {isViewingCurrent && messages().misc.current}
        </span>
      </div>
      <div className="flex gap-2">
        {isViewingCurrent ? (
          <Link to={builderPath} className={secondaryHeaderButtonClassNames}>
            {messages().misc.backToSteps}
          </Link>
        ) : (
          <button type="button" onClick={onShowCurrent} className={secondaryHeaderButtonClassNames}>
            {messages().misc.backToCurrent}
          </button>
        )}
        <button
          type="button"
          onClick={onRestore}
          disabled={isViewingCurrent || isRestoring}
          className={`${headerButtonBaseClassNames} border-0 bg-ink text-inverse hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {messages().misc.restoreV}{selectedVersion.number}
        </button>
      </div>
    </header>
  )
}

/** Why a version's steps cannot be shown, e.g. its workflow no longer compiles. */
function describeUnreadableVersion(versionSteps: VersionSteps): string | null {
  if (!versionSteps.error) return null
  return messages().misc.couldNotReadTheStepsOf(versionSteps.version, versionSteps.error.message)
}

interface StepComparisonProps {
  comparison: VersionComparison | null
  isComparing: boolean
  comparisonError: Error | null
}

/** The step list, or why it is not there yet. */
function StepComparison({ comparison, isComparing, comparisonError }: StepComparisonProps) {
  if (comparisonError) return <p className="m-0 text-muted">{messages().misc.couldNotCompareTheVersionsReason(describeError(comparisonError))}</p>
  if (isComparing || !comparison) return <p className="m-0 text-muted">{messages().misc.comparingVersions}</p>
  const unreadableMessages = [comparison.to, comparison.from].map(describeUnreadableVersion).filter((message) => message !== null)
  if (unreadableMessages.length > 0) {
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-[10px] bg-danger-tint px-3.5 py-3 text-danger-deep">
        {unreadableMessages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </div>
    )
  }
  return <StepDiffList rows={toStepDiffRows(comparison.changes)} />
}

interface RestorePreviewProps extends StepComparisonProps {
  currentVersion: VersionEntry
  selectedVersion: VersionEntry
  nextVersionNumber: number
}

function RestorePreview({ currentVersion, selectedVersion, nextVersionNumber, comparison, isComparing, comparisonError }: RestorePreviewProps) {
  const isViewingCurrent = currentVersion.number === selectedVersion.number
  // Ignore a comparison that belongs to another pair of versions while the next one loads.
  const matchingComparison = comparison && comparison.from.version === currentVersion.number && comparison.to.version === selectedVersion.number ? comparison : null

  return (
    <section aria-labelledby="restore-preview-heading" className="box-border flex min-w-0 flex-[3_1_480px] flex-col gap-4 px-8 py-7">
      <div className="flex flex-col gap-1">
        <h1 id="restore-preview-heading" className="m-0 text-[18px] font-semibold">
          {isViewingCurrent ? messages().misc.vNumberIsTheCurrentVersion(currentVersion.number) : messages().misc.whatChangesIfYouRestoreV(selectedVersion.number)}
        </h1>
        <span className="text-body">
          {isViewingCurrent
            ? messages().misc.pickAnOlderVersionInHistory
            : messages().misc.comparedWithTheCurrentVersionV(currentVersion.number)}
        </span>
      </div>
      <StepComparison comparison={matchingComparison} isComparing={isComparing} comparisonError={comparisonError} />
      <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-3 leading-normal text-body">
        {messages().misc.runsAlreadyInProgressKeepThe}{nextVersionNumber}{messages().misc.soYouCanAlwaysComeBack}
      </p>
    </section>
  )
}

function ChangeToast({ changeNotice, onUndo }: { changeNotice: ChangeNotice; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-ink py-3 pr-3 pl-[18px] text-inverse shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
    >
      <span>{changeNotice.message}</span>
      {changeNotice.previousVersionNumber !== null && (
        <button
          type="button"
          onClick={onUndo}
          className="h-8 cursor-pointer rounded-lg border-0 bg-surface px-3 font-sans text-[13px] font-semibold text-ink"
        >
          {messages().misc.undo}
        </button>
      )}
    </div>
  )
}

/** Quiet message while the history loads or when it cannot be read. */
function HistoryMessage({ children }: { children: string }) {
  return <p className="m-0 px-8 py-7 text-muted">{children}</p>
}

/**
 * Screen 24 · Version history of the agent in the `:agentId` route, from `listAgentVersions`.
 * Pick a version in History to see, step by step, what restoring it would remove or change
 * compared with the current one (`compareAgentVersions`, computed by the backend from each
 * version's step summary). Restore calls `restoreAgentVersion`, which adds a new
 * version on top; the toast's Undo restores the version that was current before.
 */
export function VersionHistoryPage() {
  const agentId = useParams().agentId ?? sampleAgentId
  const { data: agent } = useAgent(agentId)
  const versionHistory = useVersionHistory(agentId)
  const { currentVersion, selectedVersion, changeNotice } = versionHistory

  function renderContent() {
    if (versionHistory.loadError) return <HistoryMessage>{messages().misc.couldNotLoadTheHistoryReason(describeError(versionHistory.loadError))}</HistoryMessage>
    if (versionHistory.isLoading) return <HistoryMessage>{messages().misc.loadingHistory}</HistoryMessage>
    if (!currentVersion || !selectedVersion) return <HistoryMessage>{messages().misc.noSavedVersionsYet}</HistoryMessage>
    const isViewingCurrent = selectedVersion.number === currentVersion.number
    return (
      <>
        <VersionHeader
          agentId={agentId}
          agentName={agent?.name ?? messages().misc.agent}
          selectedVersion={selectedVersion}
          isViewingCurrent={isViewingCurrent}
          isRestoring={versionHistory.isRestoring}
          onShowCurrent={versionHistory.showCurrentVersion}
          onRestore={() => void versionHistory.restoreSelectedVersion()}
        />
        {versionHistory.restoreErrorMessage && (
          <p role="alert" className="m-0 border-b border-danger-line bg-danger-tint px-8 py-3 text-danger-deep">
            {versionHistory.restoreErrorMessage}
          </p>
        )}
        <div className="flex flex-auto flex-wrap">
          <RestorePreview
            currentVersion={currentVersion}
            selectedVersion={selectedVersion}
            nextVersionNumber={versionHistory.nextVersionNumber}
            comparison={versionHistory.comparison}
            isComparing={versionHistory.isComparing}
            comparisonError={versionHistory.comparisonError}
          />
          <VersionHistoryList
            versions={versionHistory.versions}
            currentVersionNumber={currentVersion.number}
            selectedVersionNumber={selectedVersion.number}
            onSelectVersion={versionHistory.selectVersion}
          />
        </div>
        {changeNotice && <ChangeToast changeNotice={changeNotice} onUndo={() => void versionHistory.undoLastChange()} />}
      </>
    )
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }} mainClassName="flex flex-col">
      {renderContent()}
    </AppShell>
  )
}
