import { useState } from 'react'
import { dismissCrashNotice, getCrashNotice, openCrashReportIssue } from '@/api/crashReports'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { CrashReportViewer } from './CrashReportViewer'
import { messages } from '@/i18n'

const noticeButtonClassNames =
  'cursor-pointer rounded-lg border-0 bg-transparent px-2 py-1 font-sans text-[13px] font-semibold text-brand hover:bg-brand-tint hover:text-brand-strong'

/**
 * The small, non-blocking notice on the launch after graphrt crashed:
 * "graphrt closed unexpectedly. A crash report was saved on this computer — View · Dismiss",
 * plus "Open a GitHub issue" when the user opted in to sharing. Nothing is sent by itself.
 */
export function CrashReportNotice() {
  const { data: crashNotice } = useAsyncData(getCrashNotice, [])
  const [isDismissed, setIsDismissed] = useState(false)
  const [isViewing, setIsViewing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  if (!crashNotice || isDismissed) return null
  const reportId = crashNotice.report.id

  async function handleDismiss() {
    setIsDismissed(true)
    try {
      await dismissCrashNotice(reportId)
    } catch (dismissError) {
      console.warn('graphrt: could not remember the dismissed crash notice', dismissError)
    }
  }

  async function handleOpenIssue() {
    setActionError(null)
    try {
      await openCrashReportIssue(reportId)
    } catch (openError) {
      setActionError(messages().misc.couldNotOpenGithubReason(describeError(openError)))
    }
  }

  return (
    <>
      <aside
        role="status"
        aria-label={messages().misc.crashReportNotice}
        className="fixed right-4 bottom-4 z-40 box-border flex max-w-[min(440px,calc(100vw-32px))] flex-col gap-1.5 rounded-[12px] border border-line-strong bg-surface px-4 py-3 font-sans shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
      >
        <p className="m-0 text-[13px] leading-normal text-ink">{messages().misc.graphrtClosedUnexpectedlyACrashReport}</p>
        <span className="-ml-2 flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setIsViewing(true)} className={noticeButtonClassNames}>
            {messages().misc.view}
          </button>
          {crashNotice.offersSharing && (
            <button type="button" onClick={() => void handleOpenIssue()} className={noticeButtonClassNames}>
              {messages().misc.openAGithubIssue}
            </button>
          )}
          <button type="button" onClick={() => void handleDismiss()} className={noticeButtonClassNames}>
            {messages().misc.dismiss}
          </button>
        </span>
        {actionError && (
          <p role="alert" className="m-0 text-[12px] text-danger">
            {actionError}
          </p>
        )}
      </aside>
      {isViewing && <CrashReportViewer reportId={reportId} onClose={() => setIsViewing(false)} />}
    </>
  )
}
