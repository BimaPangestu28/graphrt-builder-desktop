import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import { describeError } from '@/lib/agentDisplay'
import { messages, useT } from '@/i18n'

interface BrowserRuntimeBannerProps {
  runtime: BrowserRuntimeState
  /** Display names of the installed plugins that need Chromium, named in the banner. */
  pluginLabels: string[]
}

function describeBannerStatus(runtime: BrowserRuntimeState): { label: string; tone: 'ok' | 'amber' | 'danger' | 'neutral' } {
  const t = messages().plugins
  if (runtime.loadError) return { label: t.couldNotCheck, tone: 'danger' }
  if (runtime.status === null) return { label: t.checking, tone: 'neutral' }
  if (runtime.status === 'installed') return { label: t.installed, tone: 'ok' }
  if (runtime.status === 'installing') return { label: runtime.progressText ?? t.installing, tone: 'neutral' }
  return { label: t.notInstalled, tone: 'amber' }
}

/**
 * One-line browser runtime (Chromium) status at the top of the Plugins page, shown while
 * an installed plugin needs it. Amber with Install until it is there, quiet afterwards.
 */
export function BrowserRuntimeBanner({ runtime, pluginLabels }: BrowserRuntimeBannerProps) {
  const status = describeBannerStatus(runtime)
  const t = useT().plugins
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling
  const isReady = runtime.status === 'installed'
  return (
    <section
      aria-label={t.browserRuntime}
      className={joinClassNames('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5', isReady ? 'border-line bg-subtle' : 'border-amber-line-2 bg-amber-tint')}
    >
      <Icon name="monitor" size={16} className={isReady ? 'text-muted' : 'text-amber'} />
      <span className="font-medium">{t.browserRuntime}</span>
      <span role="status">
        <Badge tone={status.tone} className="whitespace-normal">
          {status.label}
        </Badge>
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-muted">{t.chromiumFor(pluginLabels.join(', '))}</span>
      {(canInstall || runtime.isInstalling) && (
        <Button size="sm" disabled={!canInstall} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? t.installing : t.installBrowserRuntime}
        </Button>
      )}
      {runtime.installError && (
        <p role="alert" className="m-0 basis-full text-[13px] text-danger">
          {t.couldNotInstallBrowser(runtime.installError)}
        </p>
      )}
      {runtime.loadError && <p className="m-0 basis-full text-[12px] text-danger">{describeError(runtime.loadError)}</p>}
    </section>
  )
}
