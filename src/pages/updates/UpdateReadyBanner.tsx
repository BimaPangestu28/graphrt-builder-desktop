import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { routePaths } from '@/routes'
import { RestartControls } from './RestartControls'
import type { AppUpdateControls, UpdateStatus } from './updateContext'
import { messages } from '@/i18n'

/** Where "Later" is remembered, so a dismissed version stays hidden after a restart. */
const DISMISSED_VERSION_KEY = 'graphrt.updateToast.dismissedVersion'

function readDismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

function rememberDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_VERSION_KEY, version)
  } catch {
    // Storage blocked: "Later" still hides the toast until the app restarts.
  }
}

/** The update the toast is about, or null when there is nothing to show. */
function updateVersionOf(status: UpdateStatus): string | null {
  if (status.kind === 'available' || status.kind === 'downloading' || status.kind === 'ready') return status.update.version
  return null
}

const toastClassNames =
  'fixed right-4 bottom-4 z-40 box-border flex w-[min(360px,calc(100vw-32px))] flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4 text-[14px] text-ink shadow-[0_8px_24px_rgba(0,0,0,0.12)]'

const secondaryButtonClassNames =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle'

const primaryButtonClassNames =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border-0 bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50'

function UpdateToast({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={toastClassNames}>
      {children}
    </section>
  )
}

function WhatsNewLink() {
  return (
    <Link to={routePaths.settings} className="text-[13px] font-medium">
      {messages().misc.whatsNew}
    </Link>
  )
}

/** "graphrt 0.2.0 is available" with Update and Later (automatic download off, or it failed). */
function UpdateAvailableToast({ updateControls, onLater }: { updateControls: AppUpdateControls; onLater: () => void }) {
  const { status, currentVersion } = updateControls
  if (status.kind !== 'available') return null
  return (
    <UpdateToast label={messages().misc.updateAvailable}>
      <div className="flex flex-col gap-0.5">
        <p className="m-0 font-semibold">{messages().misc.graphrt}{' '}{status.update.version} {messages().misc.isAvailable}</p>
        {currentVersion && <span className="text-[13px] text-muted">{messages().misc.youHave}{' '}{currentVersion}</span>}
      </div>
      {status.downloadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {messages().misc.couldNotDownloadIt}{' '}{status.downloadError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryButtonClassNames} onClick={() => void updateControls.downloadNow()}>
          {status.downloadError ? messages().misc.tryAgain : messages().misc.update}
        </button>
        <button type="button" className={secondaryButtonClassNames} onClick={onLater}>
          {messages().misc.later}
        </button>
        <WhatsNewLink />
      </div>
    </UpdateToast>
  )
}

/** "Downloading graphrt 0.2.0… 40%" with a progress bar; Hide keeps it downloading. */
function UpdateDownloadingToast({ updateControls, onHide }: { updateControls: AppUpdateControls; onHide: () => void }) {
  const { status } = updateControls
  if (status.kind !== 'downloading') return null
  const percentLabel = status.percent === null ? '' : ` ${status.percent}%`
  return (
    <UpdateToast label={messages().misc.downloadingUpdate}>
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 font-semibold">
          {messages().misc.downloadingGraphrt}{' '}{status.update.version}…{percentLabel}
        </p>
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-ink-2" onClick={onHide}>
          {messages().misc.hide}
        </button>
      </div>
      <div
        role="progressbar"
        aria-label={messages().misc.downloadingGraphrtVersion(status.update.version)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.percent ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className={status.percent === null ? 'h-full w-1/3 rounded-full bg-brand motion-safe:animate-pulse' : 'h-full rounded-full bg-brand'}
          style={status.percent === null ? undefined : { width: `${status.percent}%` }}
        />
      </div>
      <span className="text-[13px] text-muted">{messages().misc.youCanKeepWorkingItInstalls}</span>
    </UpdateToast>
  )
}

/**
 * Small toast in the bottom-right corner about a new graphrt version:
 * - available (automatic download off or failed): "graphrt X is available" with Update and Later
 * - downloading: progress, which can be hidden
 * - ready: "graphrt X is ready" with Restart and Later
 *
 * It never blocks the screen. "Later" hides it for that version, also after a restart; a
 * newer version shows it again. Settings > Updates still offers everything.
 */
export function UpdateReadyBanner({ updateControls }: { updateControls: AppUpdateControls }) {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(readDismissedVersion)
  const [hiddenDownloadVersion, setHiddenDownloadVersion] = useState<string | null>(null)
  const { status } = updateControls
  const version = updateVersionOf(status)
  if (version === null || dismissedVersion === version) return null

  function dismiss() {
    if (version === null) return
    rememberDismissedVersion(version)
    setDismissedVersion(version)
  }

  if (status.kind === 'available') return <UpdateAvailableToast updateControls={updateControls} onLater={dismiss} />
  if (status.kind === 'downloading') {
    if (hiddenDownloadVersion === version) return null
    return <UpdateDownloadingToast updateControls={updateControls} onHide={() => setHiddenDownloadVersion(version)} />
  }
  if (status.kind !== 'ready') return null
  return (
    <UpdateToast label={messages().misc.updateReady}>
      <p className="m-0 font-semibold">{messages().misc.graphrt}{' '}{status.update.version} {messages().misc.isReady}</p>
      <RestartControls updateControls={updateControls} onLater={dismiss} />
    </UpdateToast>
  )
}
