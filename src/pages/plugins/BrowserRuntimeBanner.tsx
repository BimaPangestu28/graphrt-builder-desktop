import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { describeError } from '@/lib/agentDisplay'

interface BrowserRuntimeBannerProps {
  runtime: BrowserRuntimeState
  /** Installed plugins that need Chromium, named in the banner. */
  pluginNames: string[]
}

function describeBannerStatus(runtime: BrowserRuntimeState): { label: string; tone: 'ok' | 'amber' | 'danger' | 'neutral' } {
  if (runtime.loadError) return { label: 'Could not check', tone: 'danger' }
  if (runtime.status === null) return { label: 'Checking…', tone: 'neutral' }
  if (runtime.status === 'installed') return { label: 'Installed', tone: 'ok' }
  if (runtime.status === 'installing') return { label: runtime.progressText ?? 'Installing…', tone: 'neutral' }
  return { label: 'Not installed', tone: 'amber' }
}

/**
 * One-line browser runtime (Chromium) status at the top of the Plugins page, shown while
 * an installed plugin needs it. Amber with Install until it is there, quiet afterwards.
 */
export function BrowserRuntimeBanner({ runtime, pluginNames }: BrowserRuntimeBannerProps) {
  const status = describeBannerStatus(runtime)
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling
  const isReady = runtime.status === 'installed'
  return (
    <section
      aria-label="Browser runtime"
      className={joinClassNames('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5', isReady ? 'border-line bg-subtle' : 'border-amber-line-2 bg-amber-tint')}
    >
      <Icon name="monitor" size={16} className={isReady ? 'text-muted' : 'text-amber'} />
      <span className="font-medium">Browser runtime</span>
      <span role="status">
        <Badge tone={status.tone} className="whitespace-normal">
          {status.label}
        </Badge>
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-muted">Chromium for {pluginNames.join(', ')} · about 150 MB</span>
      {(canInstall || runtime.isInstalling) && (
        <Button size="sm" disabled={!canInstall} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? 'Installing…' : 'Install browser runtime'}
        </Button>
      )}
      {runtime.installError && (
        <p role="alert" className="m-0 basis-full text-[13px] text-danger">
          Could not install the browser runtime: {runtime.installError}
        </p>
      )}
      {runtime.loadError && <p className="m-0 basis-full text-[12px] text-danger">{describeError(runtime.loadError)}</p>}
    </section>
  )
}
