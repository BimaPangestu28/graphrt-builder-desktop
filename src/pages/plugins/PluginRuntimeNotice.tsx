import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listInstalledPlugins } from '@/api/plugins'
import { pluginRuntimeDownloadSizeNote } from '@/api/pluginTypes'
import { Button } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { usePluginRuntime } from '@/hooks/usePluginRuntime'
import { routePaths } from '@/routes'

/** Where "Later" is remembered (the pinned Node version), so the notice shows once per runtime version. */
const DISMISSED_RUNTIME_VERSION_KEY = 'graphrt.pluginRuntimeNotice.dismissedVersion'

function readDismissedRuntimeVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_RUNTIME_VERSION_KEY)
  } catch {
    return null
  }
}

function rememberDismissedRuntimeVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_RUNTIME_VERSION_KEY, version)
  } catch {
    // Storage blocked: "Later" still hides the notice until the app restarts.
  }
}

/** "WhatsApp Web and 2 more" for the notice text. */
export function describeWaitingPlugins(pluginLabels: string[]): string {
  if (pluginLabels.length <= 2) return pluginLabels.join(' and ')
  return `${pluginLabels[0]} and ${pluginLabels.length - 1} more`
}

/**
 * One-time notice for people who updated from a version that shipped Node.js inside the app
 * (0.1.x): their installed plugins now need the plugin runtime, downloaded once. Shown on
 * every screen but Plugins (which has its own banner) until the user picks "Download now"
 * (an explicit OK, the only way it downloads) or "Later" (remembered for this runtime
 * version; the Plugins banner, the plugin pages, the builder and Home still offer it).
 * Nothing shows for new installs without plugins, or once the runtime is there.
 */
export function PluginRuntimeNotice() {
  const { pathname } = useLocation()
  const installedPlugins = useAsyncData(listInstalledPlugins, [])
  const runtime = usePluginRuntime()
  const [dismissedVersion, setDismissedVersion] = useState(readDismissedRuntimeVersion)
  const pinnedVersion = runtime.info?.pinnedVersion ?? null
  const waitingPluginLabels = (installedPlugins.data ?? []).filter((plugin) => plugin.needsNodeRuntime).map((plugin) => plugin.displayName)
  const isOnPluginsScreen = pathname.startsWith(routePaths.plugins)
  const isRelevant = waitingPluginLabels.length > 0 && runtime.info?.downloadable !== false && (runtime.status === 'not_installed' || runtime.isInstalling || runtime.installError !== null)
  if (!isRelevant || isOnPluginsScreen || pinnedVersion === null || dismissedVersion === pinnedVersion) return null

  function handleLater() {
    if (pinnedVersion === null) return
    rememberDismissedRuntimeVersion(pinnedVersion)
    setDismissedVersion(pinnedVersion)
  }

  return (
    <section
      aria-label="Plugin runtime needed"
      className="fixed top-4 right-4 z-40 box-border flex w-[min(380px,calc(100vw-32px))] flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4 text-[14px] text-ink shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
    >
      <b className="font-semibold">Your plugins need a one-time download</b>
      <p className="m-0 text-[13px] leading-normal text-body">
        graphrt no longer ships Node.js inside the app, so it is much smaller. {describeWaitingPlugins(waitingPluginLabels)} {waitingPluginLabels.length === 1 ? 'needs' : 'need'} the plugin runtime (Node.js v{pinnedVersion}, {pluginRuntimeDownloadSizeNote} from nodejs.org) before {waitingPluginLabels.length === 1 ? 'it runs' : 'they run'} again.
      </p>
      {runtime.isInstalling && (
        <p role="status" className="m-0 text-[13px] text-ink-2">
          {runtime.progressText ?? 'Starting the download…'}
        </p>
      )}
      {runtime.installError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not download it: {runtime.installError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link to={routePaths.plugins} className="mr-auto text-[13px] font-medium">
          Open plugins
        </Link>
        {!runtime.isInstalling && (
          <Button variant="ghost" size="sm" onClick={handleLater}>
            Later
          </Button>
        )}
        <Button size="sm" disabled={runtime.isInstalling} onClick={() => void runtime.install()}>
          {runtime.isInstalling ? 'Downloading…' : runtime.installError ? 'Try again' : 'Download now'}
        </Button>
      </div>
    </section>
  )
}
