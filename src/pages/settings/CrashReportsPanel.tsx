import { useState } from 'react'
import { deleteAllCrashReports, exportCrashReports, getCrashReportSharing, listCrashReports, pickCrashReportExportPath, setCrashReportSharing } from '@/api/crashReports'
import type { CrashReportSummary } from '@/api/crashReportTypes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { CrashReportViewer } from '../crash-reports/CrashReportViewer'
import { ToggleRow, settingsButtonClassNames } from './SettingRows'

type CrashReportActionState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'confirmDelete' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

const reportTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function describeReportCount(reportCount: number): string {
  return `${reportCount} crash ${reportCount === 1 ? 'report' : 'reports'}`
}

/** The opt-in toggle; saved right away, put back when the save fails. */
function SharingToggle() {
  const { data: storedOffersSharing } = useAsyncData(getCrashReportSharing, [])
  const [pendingOffersSharing, setPendingOffersSharing] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const offersSharing = pendingOffersSharing ?? storedOffersSharing
  if (offersSharing === null) return null

  async function handleToggle(isChecked: boolean) {
    setPendingOffersSharing(isChecked)
    setSaveError(null)
    try {
      setPendingOffersSharing(await setCrashReportSharing(isChecked))
    } catch (saveFailure) {
      setPendingOffersSharing(!isChecked)
      setSaveError(`Could not save the change: ${describeError(saveFailure)}`)
    }
  }

  return (
    <>
      <ToggleRow
        title="Help improve graphrt: offer to share crash reports"
        description="After a crash, offer to open a GitHub issue you can read before you submit it. Nothing is ever sent by itself"
        isChecked={offersSharing}
        onToggle={(isChecked) => void handleToggle(isChecked)}
      />
      {saveError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {saveError}
        </p>
      )}
    </>
  )
}

function CrashReportList({ reports, onView }: { reports: CrashReportSummary[]; onView: (reportId: string) => void }) {
  if (reports.length === 0) return <p className="m-0 py-2 text-[13px] text-muted">No crash reports on this computer</p>
  return (
    <ul aria-label="Saved crash reports" className="m-0 flex max-h-[260px] list-none flex-col overflow-auto rounded-[10px] border border-line p-0">
      {reports.map((report) => (
        <li key={report.id} className="flex items-center gap-3 border-b border-chip px-3 py-2 last:border-b-0">
          <span className="flex min-w-0 flex-auto flex-col">
            <span className="text-[12px] text-muted">
              {reportTimeFormat.format(new Date(report.createdAt))} · {report.kind === 'panic' ? 'App closed' : 'Window error'}
            </span>
            <span className="truncate text-[13px] text-ink">{report.message || 'No message'}</span>
          </span>
          <button type="button" aria-label={`View the crash report from ${reportTimeFormat.format(new Date(report.createdAt))}`} onClick={() => onView(report.id)} className={`${settingsButtonClassNames} h-[30px] shrink-0`}>
            View
          </button>
        </li>
      ))}
    </ul>
  )
}

function ActionMessage({ actionState }: { actionState: CrashReportActionState }) {
  if (actionState.kind === 'done') {
    return (
      <p role="status" className="m-0 text-[13px] text-body">
        {actionState.message}
      </p>
    )
  }
  if (actionState.kind === 'failed') {
    return (
      <p role="alert" className="m-0 text-[13px] text-danger">
        {actionState.message}
      </p>
    )
  }
  return null
}

/**
 * Settings > Privacy and data > Crash reports: the no-telemetry statement, the sharing
 * opt-in, the reports saved on this computer (View shows the scrubbed JSON), Export all
 * (system save dialog) and Delete all (asks first).
 */
export function CrashReportsPanel() {
  const { data: reports, error: loadError, reload } = useAsyncData(listCrashReports, [])
  const [viewedReportId, setViewedReportId] = useState<string | null>(null)
  const [actionState, setActionState] = useState<CrashReportActionState>({ kind: 'idle' })
  const hasReports = (reports?.length ?? 0) > 0
  const isWorking = actionState.kind === 'working'

  async function handleExport() {
    setActionState({ kind: 'working' })
    try {
      const exportPath = await pickCrashReportExportPath()
      if (!exportPath) return setActionState({ kind: 'idle' })
      const summary = await exportCrashReports(exportPath)
      setActionState({ kind: 'done', message: `Exported ${describeReportCount(summary.reportCount)} to ${summary.path}` })
    } catch (exportFailure) {
      setActionState({ kind: 'failed', message: `Could not export: ${describeError(exportFailure)}` })
    }
  }

  async function handleDelete() {
    setActionState({ kind: 'working' })
    try {
      const deletedCount = await deleteAllCrashReports()
      setActionState({ kind: 'done', message: `Deleted ${describeReportCount(deletedCount)}` })
      await reload()
    } catch (deleteFailure) {
      setActionState({ kind: 'failed', message: `Could not delete: ${describeError(deleteFailure)}` })
    }
  }

  return (
    <section aria-labelledby="settings-crash-reports-heading" className="flex flex-col gap-2 border-b border-chip py-3.5">
      <h3 id="settings-crash-reports-heading" className="m-0 text-[14px] font-medium">
        Crash reports
      </h3>
      <p className="m-0 text-[13px] leading-normal text-body">
        graphrt sends no telemetry. When it crashes, a report is saved only on this computer, without keys, secrets, workflow inputs, run outputs, file contents, emails or your user name
      </p>
      <SharingToggle />
      {loadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not list the crash reports: {loadError.message}
        </p>
      )}
      {reports && <CrashReportList reports={reports} onView={setViewedReportId} />}
      <div className="flex gap-2 pt-1.5">
        <button type="button" disabled={!hasReports || isWorking} onClick={() => void handleExport()} className={`${settingsButtonClassNames} h-9 disabled:cursor-not-allowed disabled:opacity-50`}>
          Export all
        </button>
        <button
          type="button"
          disabled={!hasReports || isWorking}
          onClick={() => setActionState({ kind: 'confirmDelete' })}
          className="h-9 cursor-pointer rounded-[9px] border border-danger-line bg-surface px-3.5 font-sans text-[13px] font-medium text-danger hover:bg-danger-tint disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete all
        </button>
      </div>
      {actionState.kind === 'confirmDelete' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3">
          <span className="flex-auto text-[13px] text-danger-deep">Delete every crash report on this computer?</span>
          <button type="button" onClick={() => setActionState({ kind: 'idle' })} className={`${settingsButtonClassNames} h-[34px]`}>
            Cancel
          </button>
          <button type="button" onClick={() => void handleDelete()} className="h-[34px] cursor-pointer rounded-[9px] border-0 bg-danger px-3.5 font-sans text-[13px] font-semibold text-white">
            Delete crash reports
          </button>
        </div>
      )}
      <ActionMessage actionState={actionState} />
      {viewedReportId && <CrashReportViewer reportId={viewedReportId} onClose={() => setViewedReportId(null)} />}
    </section>
  )
}
