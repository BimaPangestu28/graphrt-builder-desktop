import { Badge, Button, joinClassNames, type BadgeTone } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { describeError } from '@/lib/agentDisplay'
import { messages } from '@/i18n'

interface BrowserRuntimeCardProps {
  runtime: BrowserRuntimeState
  /** Inside a setup checklist step: a quieter box without its own title, the step names it. */
  isEmbedded?: boolean
}

function describeRuntimeStatus(runtime: BrowserRuntimeState): string {
  const t = messages().plugins
  if (runtime.loadError) return t.couldNotCheckBrowser(describeError(runtime.loadError))
  if (runtime.status === null) return t.checkingBrowser
  if (runtime.status === 'installed') return t.installed
  if (runtime.status === 'installing') return runtime.progressText ?? t.installing
  return t.notInstalled
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
export function BrowserRuntimeCard({ runtime, isEmbedded = false }: BrowserRuntimeCardProps) {
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling
  return (
    <div
      className={joinClassNames(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border border-line',
        isEmbedded ? 'rounded-[10px] bg-subtle px-3 py-2.5' : 'rounded-[14px] bg-surface px-4 py-3',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {!isEmbedded && <b className="font-semibold text-ink">{messages().plugins.browserRuntime}</b>}
          <span role="status">
            <Badge tone={pickRuntimeStatusTone(runtime)} className="whitespace-normal">
              {describeRuntimeStatus(runtime)}
            </Badge>
          </span>
        </div>
        <p className="m-0 text-[13px] text-body">{messages().plugins.chromiumGeneric}</p>
        {runtime.installError && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {messages().plugins.couldNotInstallBrowser(runtime.installError)}
          </p>
        )}
      </div>
      {(canInstall || runtime.isInstalling) && (
        <Button size="sm" className="ml-auto" disabled={!canInstall} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? messages().plugins.installing : messages().plugins.installBrowserRuntime}
        </Button>
      )}
    </div>
  )
}
