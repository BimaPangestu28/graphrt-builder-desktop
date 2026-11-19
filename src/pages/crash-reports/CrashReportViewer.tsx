import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getCrashReport } from '@/api/crashReports'
import { StrokeIcon } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { keepTabFocusInside, useFocusOnOpenAndRestore } from '@/pages/onboarding/useDialogFocusTrap'

interface CrashReportViewerProps {
  reportId: string
  onClose: () => void
}

/**
 * One crash report as stored (already scrubbed), in a modal dialog: exactly what
 * exporting or sharing it would hand over. Escape or the close button closes it.
 */
export function CrashReportViewer({ reportId, onClose }: CrashReportViewerProps) {
  const { data: reportJson, error } = useAsyncData(() => getCrashReport(reportId), [reportId])
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useFocusOnOpenAndRestore(closeButtonRef)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (dialogRef.current) keepTabFocusInside(event, dialogRef.current)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 box-border flex items-center justify-center bg-[rgba(24,24,27,0.5)] p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[calc(100vh-48px)] w-full max-w-[720px] flex-col gap-3 rounded-[16px] bg-surface p-5 shadow-[0_24px_64px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex flex-col gap-1">
            <h2 id={titleId} className="m-0 text-[15px] font-semibold text-ink">
              Crash report
            </h2>
            <span className="text-[13px] text-body">Exactly what is saved and what would be shared. Keys, inputs, outputs, file contents, emails and your user name are removed</span>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close the crash report"
            onClick={onClose}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand"
          >
            <StrokeIcon size={16}>
              <path d="M7 7l10 10M17 7 7 17" />
            </StrokeIcon>
          </button>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            Could not open the report: {error.message}
          </p>
        )}
        {!error && reportJson === null && (
          <p role="status" className="m-0 text-[13px] text-muted">
            Loading the report…
          </p>
        )}
        {reportJson !== null && (
          <pre
            aria-label="Crash report contents"
            className="m-0 min-h-0 flex-auto overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-ink"
          >
            {reportJson}
          </pre>
        )}
      </div>
    </div>,
    document.body,
  )
}
