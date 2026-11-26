import { pluginRuntimeDownloadSizeNote } from '@/api/pluginTypes'
import { Badge, Button, Icon, joinClassNames, type BadgeTone } from '@/components/ui'
import type { PluginRuntimeState } from '@/hooks/usePluginRuntime'
import { describeError } from '@/lib/agentDisplay'

/** What the plugin runtime is, in one line: shown before anything is downloaded. */
export const pluginRuntimeNeedNote = `Needs the plugin runtime (Node.js, ${pluginRuntimeDownloadSizeNote()})`

/** Added to an install approval while the plugin runtime is missing: the same click downloads it. */
export const pluginRuntimeInstallNote = `Also downloads the plugin runtime (Node.js, ${pluginRuntimeDownloadSizeNote()}, once for all plugins) from nodejs.org.`

/** Status badge text and tone of the plugin runtime. */
export function describePluginRuntimeStatus(runtime: PluginRuntimeState): { label: string; tone: BadgeTone } {
  if (runtime.loadError) return { label: 'Could not check', tone: 'danger' }
  if (runtime.status === null) return { label: 'Checking…', tone: 'neutral' }
  if (runtime.status === 'installed') return { label: 'Installed', tone: 'ok' }
  if (runtime.status === 'installing') return { label: runtime.progressText ?? 'Installing…', tone: 'neutral' }
  return { label: 'Not installed', tone: 'amber' }
}

function PluginRuntimeInstallButton({ runtime }: { runtime: PluginRuntimeState }) {
  const canInstall = runtime.status === 'not_installed' && !runtime.isInstalling && runtime.info?.downloadable !== false
  if (!canInstall && !runtime.isInstalling) return null
  return (
    <Button size="sm" disabled={!canInstall} onClick={() => void runtime.install()}>
      {runtime.isInstalling ? 'Installing…' : 'Install plugin runtime'}
    </Button>
  )
}

function PluginRuntimeErrors({ runtime }: { runtime: PluginRuntimeState }) {
  return (
    <>
      {runtime.installError && (
        <p role="alert" className="m-0 basis-full text-[13px] text-danger">
          Could not install the plugin runtime: {runtime.installError}
        </p>
      )}
      {runtime.info?.downloadable === false && runtime.status === 'not_installed' && (
        <p className="m-0 basis-full text-[13px] text-danger">The plugin runtime is not available for this computer, so plugins cannot run here</p>
      )}
    </>
  )
}

interface PluginRuntimeCardProps {
  runtime: PluginRuntimeState
  /** Inside a setup checklist step: a quieter box without its own title, the step names it. */
  isEmbedded?: boolean
}

/**
 * The plugin runtime (Node.js) every plugin runs on, laid out like the browser runtime row:
 * name and status on the left, Install on the right, progress in the status badge.
 */
export function PluginRuntimeCard({ runtime, isEmbedded = false }: PluginRuntimeCardProps) {
  const status = describePluginRuntimeStatus(runtime)
  return (
    <div
      className={joinClassNames(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border border-line',
        isEmbedded ? 'rounded-[10px] bg-subtle px-3 py-2.5' : 'rounded-[14px] bg-surface px-4 py-3',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {!isEmbedded && <b className="font-semibold text-ink">Plugin runtime</b>}
          <span role="status">
            <Badge tone={status.tone} className="whitespace-normal">
              {status.label}
            </Badge>
          </span>
        </div>
        <p className="m-0 text-[13px] text-body">Node.js, which plugins run on · {pluginRuntimeDownloadSizeNote()}, once for all plugins</p>
        <PluginRuntimeErrors runtime={runtime} />
      </div>
      <div className="ml-auto">
        <PluginRuntimeInstallButton runtime={runtime} />
      </div>
    </div>
  )
}

interface PluginRuntimeBannerProps {
  runtime: PluginRuntimeState
  /** Display names of the installed plugins that need it, named in the banner. */
  pluginLabels: string[]
}

/**
 * One-line notice at the top of the Plugins page while installed plugins need the plugin
 * runtime and it is missing (for example right after updating from a version that bundled
 * Node.js). Hidden once it is installed.
 */
export function PluginRuntimeBanner({ runtime, pluginLabels }: PluginRuntimeBannerProps) {
  if (runtime.status === 'installed' || runtime.status === null) return null
  const status = describePluginRuntimeStatus(runtime)
  return (
    <section aria-label="Plugin runtime" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-line-2 bg-amber-tint px-4 py-2.5">
      <Icon name="monitor" size={16} className="text-amber" />
      <span className="font-medium">Plugin runtime</span>
      <span role="status">
        <Badge tone={status.tone} className="whitespace-normal">
          {status.label}
        </Badge>
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-muted">
        {pluginLabels.join(', ')} {pluginLabels.length === 1 ? 'needs' : 'need'} the plugin runtime (Node.js, {pluginRuntimeDownloadSizeNote()})
      </span>
      <PluginRuntimeInstallButton runtime={runtime} />
      <PluginRuntimeErrors runtime={runtime} />
      {runtime.loadError && <p className="m-0 basis-full text-[12px] text-danger">{describeError(runtime.loadError)}</p>}
    </section>
  )
}
