import { Badge, Button, type BadgeTone } from '@/components/ui'
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

function pickRuntimeStatusTone(runtime: BrowserRuntimeState): BadgeTone {
  if (runtime.loadError) return 'danger'
  if (runtime.status === 'installed') return 'ok'
  if (runtime.status === 'not_installed') return 'amber'
  return 'neutral'
}

/**
 * The browser runtime (Chromium) that browser plugins such as personal WhatsApp and the
 * Google Maps scraper need, laid out like a plugin row: name and status on the left,
 * Install on the right, progress in the status badge.
 */
export function BrowserRuntimeCard({ runtime }: BrowserRuntimeCardProps) {
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="font-semibold text-ink">Browser runtime</b>
          <span role="status">
            <Badge tone={pickRuntimeStatusTone(runtime)} className="whitespace-normal">
              {describeRuntimeStatus(runtime)}
            </Badge>
          </span>
        </div>
        <p className="m-0 text-[13px] text-body">Chromium for plugins that open web pages · about 150 MB</p>
        {runtime.installError && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            Could not install the browser runtime: {runtime.installError}
          </p>
        )}
      </div>
      {(canInstall || runtime.isInstalling) && (
        <Button size="sm" className="ml-auto" disabled={!canInstall} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? 'Installing…' : 'Install browser runtime'}
        </Button>
      )}
    </div>
  )
}
