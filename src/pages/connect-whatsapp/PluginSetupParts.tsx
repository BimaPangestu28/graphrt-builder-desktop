import type { InstalledPlugin } from '@/api/pluginTypes'
import { Button } from '@/components/ui'
import { findInventoryDisplayName, type PluginsState } from '@/hooks/usePlugins'
import { isPluginRuntimeMissing, usePluginRuntime } from '@/hooks/usePluginRuntime'
import { describeError } from '@/lib/agentDisplay'
import { describeInstallProgress } from '../plugins/pluginDisplay'
import { PluginPermissionList } from '../plugins/PluginPermissionList'
import { pluginRuntimeInstallNote } from '../plugins/PluginRuntimeCard'
import { PluginTrustToggle } from '../plugins/PluginTrustToggle'
import { messages } from '@/i18n'

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
  const needsPluginRuntime = isPluginRuntimeMissing(usePluginRuntime())
  const inventory = plugins.data
  if (plugins.error) return <p role="alert" className="m-0 text-[13px] text-danger">{messages().chatbot.couldNotLoadPlugins}{' '}{describeError(plugins.error)}</p>
  if (!inventory) return <p className="m-0 text-[13px] text-muted">{messages().chatbot.checkingPlugins}</p>
  const pluginLabel = findInventoryDisplayName(inventory, pluginName)
  const installedPlugin = inventory.installed.find((candidate) => candidate.name === pluginName)
  if (installedPlugin) return <p className="m-0 text-[13px] text-body">{pluginLabel} v{installedPlugin.version} {messages().chatbot.isInstalled}</p>

  const catalogEntry = inventory.catalog?.plugins.find((entry) => entry.name === pluginName)
  if (!catalogEntry) {
    const reason = inventory.catalogError ? describeError(inventory.catalogError) : messages().chatbot.theCatalogHasNoPluginlabelPlugin(pluginLabel)
    return <p role="alert" className="m-0 text-[13px] text-danger">{messages().chatbot.couldNotFindThePluginTo}{' '}{reason}</p>
  }
  const progress = plugins.progressByName[pluginName]
  const isInstalling = plugins.operationByName[pluginName] === 'installing'
  return (
    <>
      <span className="text-[13px] text-body">{catalogEntry.description}{messages().chatbot.itAsksFor}</span>
      <PluginPermissionList pluginLabel={pluginLabel} permissions={catalogEntry.permissions} needsBrowser={catalogEntry.needsBrowser} />
      {needsPluginRuntime && <span className="text-[13px] text-body">{pluginRuntimeInstallNote()}</span>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          aria-label={messages().chatbot.installPluginlabel(pluginLabel)}
          disabled={isInstalling}
          onClick={() => void plugins.install(pluginName, catalogEntry.permissions, { withPluginRuntime: needsPluginRuntime })}
        >
          {isInstalling ? messages().chatbot.installing : messages().chatbot.install}
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
        pluginLabel={installedPlugin.displayName}
        isTrusted={installedPlugin.trusted}
        isSaving={plugins.operationByName[installedPlugin.name] === 'trusting'}
        onChange={(trusted) => void plugins.setTrusted(installedPlugin.name, trusted, installedPlugin.permissions)}
      />
      <PluginErrorMessage plugins={plugins} pluginName={installedPlugin.name} />
    </>
  )
}
