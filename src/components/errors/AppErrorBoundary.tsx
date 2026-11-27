import { Component, type ErrorInfo, type ReactNode } from 'react'
import { sendFrontendErrorReport } from '@/lib/frontendErrorReporting'
import { useT } from '@/i18n'

interface AppErrorBoundaryProps {
  children: ReactNode
  /** Reloads the window; replaced in tests. */
  onReload?: () => void
}

interface AppErrorBoundaryState {
  hasError: boolean
}

function reloadWindow(): void {
  window.location.reload()
}

/** The friendly screen shown instead of a broken one. */
function ErrorFallback({ onReload }: { onReload: () => void }) {
  const t = useT().shell.errorBoundary
  return (
    <main role="alert" className="flex min-h-screen items-center justify-center bg-canvas p-6 font-sans">
      <div className="flex max-w-[420px] flex-col items-center gap-3 rounded-[14px] border border-line-strong bg-surface p-7 text-center">
        <h1 className="m-0 text-[18px] font-semibold text-ink">{t.title}</h1>
        <p className="m-0 text-[14px] leading-normal text-body">
          {t.body}
        </p>
        <button
          type="button"
          onClick={onReload}
          className="h-9 cursor-pointer rounded-[9px] border-0 bg-ink px-4 font-sans text-[13px] font-semibold text-inverse"
        >
          {t.reload}
        </button>
      </div>
    </main>
  )
}

/**
 * Catches render errors anywhere below it (placed at the app root), shows
 * "Something went wrong — Reload" and saves a local crash report.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    sendFrontendErrorReport(error, 'error_boundary', errorInfo.componentStack ?? null)
  }

  render() {
    if (this.state.hasError) return <ErrorFallback onReload={this.props.onReload ?? reloadWindow} />
    return this.props.children
  }
}
