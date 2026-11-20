import type { InstalledPlugin } from '@/api/pluginTypes'
import { Button } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { describeInstallProgress } from '../plugins/pluginDisplay'
import { PluginPermissionList } from '../plugins/PluginPermissionList'
import { PluginTrustToggle } from '../plugins/PluginTrustToggle'

function PluginErrorMessage({ plugins, pluginName }: { plugins: PluginsState; pluginName: string }) {
  const errorMessage = plugins.errorByName[pluginName]
  if (!errorMessage) return null
  return (
    <p role="alert" className="m-0 text-[13px] text-danger">
      {errorMessage}
    </p>
  )
}

/** Install step body: what the plugin asks for, then Install with progress. Says so once installed. */
export function PluginInstallStepBody({ plugins, pluginName }: { plugins: PluginsState; pluginName: string }) {
  const inventory = plugins.data
  if (plugins.error) return <p role="alert" className="m-0 text-[13px] text-danger">Could not load plugins: {describeError(plugins.error)}</p>
  if (!inventory) return <p className="m-0 text-[13px] text-muted">Checking plugins…</p>
  const installedPlugin = inventory.installed.find((candidate) => candidate.name === pluginName)
  if (installedPlugin) return <p className="m-0 text-[13px] text-body">{pluginName} v{installedPlugin.version} is installed</p>

  const catalogEntry = inventory.catalog?.plugins.find((entry) => entry.name === pluginName)
  if (!catalogEntry) {
    const reason = inventory.catalogError ? describeError(inventory.catalogError) : `the catalog has no ${pluginName} plugin`
    return <p role="alert" className="m-0 text-[13px] text-danger">Could not find the plugin to install: {reason}</p>
  }
  const progress = plugins.progressByName[pluginName]
  const isInstalling = plugins.operationByName[pluginName] === 'installing'
  return (
    <>
      <span className="text-[13px] text-body">{catalogEntry.description}. It asks for:</span>
      <PluginPermissionList pluginName={pluginName} permissions={catalogEntry.permissions} needsBrowser={catalogEntry.needsBrowser} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" aria-label={`Install ${pluginName}`} disabled={isInstalling} onClick={() => void plugins.install(pluginName)}>
          {isInstalling ? 'Installing…' : 'Install'}
        </Button>
        {progress && (
          <span role="status" className="text-[13px] text-ink-2">
            {describeInstallProgress(progress)}
          </span>
        )}
      </div>
      <PluginErrorMessage plugins={plugins} pluginName={pluginName} />
    </>
  )
}

/** Trust step body: the checkbox with its warning. */
export function PluginTrustStepBody({ plugins, installedPlugin }: { plugins: PluginsState; installedPlugin: InstalledPlugin }) {
  return (
    <>
      <PluginTrustToggle
        pluginName={installedPlugin.name}
        isTrusted={installedPlugin.trusted}
        isSaving={plugins.operationByName[installedPlugin.name] === 'trusting'}
        onChange={(trusted) => void plugins.setTrusted(installedPlugin.name, trusted)}
      />
      <PluginErrorMessage plugins={plugins} pluginName={installedPlugin.name} />
    </>
  )
}
