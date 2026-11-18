import { Button } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { describeError } from '@/lib/agentDisplay'

interface BrowserRuntimeCardProps {
  runtime: BrowserRuntimeState
}

function describeRuntimeStatus(runtime: BrowserRuntimeState): string {
  if (runtime.loadError) return `Could not check the browser runtime: ${describeError(runtime.loadError)}`
  if (runtime.status === null) return 'Checking the browser runtime…'
  if (runtime.status === 'installed') return 'Installed'
  if (runtime.status === 'installing') return runtime.progressText ?? 'Installing…'
  return 'Not installed'
}

/**
 * The browser runtime (Chromium) that browser plugins such as personal WhatsApp and the
 * Google Maps scraper need, with an Install button and its progress.
 */
export function BrowserRuntimeCard({ runtime }: BrowserRuntimeCardProps) {
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">Browser runtime</span>
        <span className="text-[12px] text-muted">Chromium for plugins that open web pages · about 150 MB</span>
        <span role="status" className={runtime.status === 'installed' ? 'text-[13px] text-ok-strong' : 'text-[13px] text-ink-2'}>
          {describeRuntimeStatus(runtime)}
        </span>
        {runtime.installError && (
          <span role="alert" className="text-[13px] text-danger">
            Could not install the browser runtime: {runtime.installError}
          </span>
        )}
      </span>
      {(canInstall || runtime.isInstalling) && (
        <Button size="sm" disabled={!canInstall} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? 'Installing…' : 'Install browser runtime'}
        </Button>
      )}
    </div>
  )
}
