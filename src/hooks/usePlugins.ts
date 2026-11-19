import { useCallback, useState } from 'react'
import {
  deletePluginConfig,
  installPlugin,
  listInstalledPlugins,
  listPluginCatalog,
  listenToPluginEvents,
  removePlugin,
  setPluginConfig,
  setPluginTrusted,
  updatePlugin,
} from '@/api/plugins'
import type { InstalledPlugin, PluginCatalog, PluginEvent, PluginInstallStage } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import { useAsyncData, type AsyncDataState } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

/** Installed plugins plus the catalog. The catalog may fail on its own (offline) without hiding installed plugins. */
export interface PluginInventory {
  catalog: PluginCatalog | null
  catalogError: Error | null
  installed: InstalledPlugin[]
}

/** The latest `install_progress` of a plugin being installed or updated. */
export interface PluginInstallProgress {
  stage: PluginInstallStage
  /** 0 to 100 when the download size is known, else null. */
  percent: number | null
  message: string | null
}

export type PluginOperation = 'installing' | 'updating' | 'removing' | 'trusting'

const operationVerbs: Record<PluginOperation, string> = { installing: 'install', updating: 'update', removing: 'remove', trusting: 'change trust for' }

export interface PluginsState extends AsyncDataState<PluginInventory> {
  progressByName: Record<string, PluginInstallProgress>
  operationByName: Record<string, PluginOperation>
  /** Last failed install / update / remove / trust per plugin, as text to show. */
  errorByName: Record<string, string>
  install: (name: string) => Promise<void>
  update: (name: string) => Promise<void>
  remove: (name: string) => Promise<void>
  setTrusted: (name: string, trusted: boolean) => Promise<void>
  /** Saves a setting; rejects with the backend error so the form can show it. */
  saveConfig: (name: string, variable: string, value: string) => Promise<void>
  /** Clears a setting; rejects with the backend error so the form can show it. */
  clearConfig: (name: string, variable: string) => Promise<void>
}

function toError(rawError: unknown): Error {
  return rawError instanceof Error ? rawError : new Error(describeError(rawError))
}

async function loadPluginInventory(): Promise<PluginInventory> {
  const [installed, catalogResult] = await Promise.all([
    listInstalledPlugins(),
    listPluginCatalog(false).then(
      (catalog) => ({ catalog, catalogError: null }),
      (catalogError: unknown) => ({ catalog: null, catalogError: toError(catalogError) }),
    ),
  ])
  return { installed, ...catalogResult }
}

/** Turns an `install_progress` event into the progress shown next to a plugin (percent when the size is known). */
export function toInstallProgress(pluginEvent: Extract<PluginEvent, { type: 'install_progress' }>): PluginInstallProgress {
  const { receivedBytes, totalBytes } = pluginEvent
  const percent = receivedBytes !== null && totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null
  return { stage: pluginEvent.stage, percent, message: pluginEvent.message }
}

function withoutKey<Value>(record: Record<string, Value>, key: string): Record<string, Value> {
  const remaining = { ...record }
  delete remaining[key]
  return remaining
}

/** Follows `plugin-event`: keeps install progress per plugin and reloads when plugins change. */
function usePluginInstallProgress(reload: () => Promise<void>) {
  const [progressByName, setProgressByName] = useState<Record<string, PluginInstallProgress>>({})
  const handlePluginEvent = useCallback(
    (pluginEvent: PluginEvent) => {
      if (pluginEvent.type === 'install_progress') {
        setProgressByName((previous) => ({ ...previous, [pluginEvent.name]: toInstallProgress(pluginEvent) }))
        return
      }
      void reload()
    },
    [reload],
  )
  useBackendSubscription(listenToPluginEvents, handlePluginEvent)
  const clearProgress = useCallback((name: string) => setProgressByName((previous) => withoutKey(previous, name)), [])
  return { progressByName, clearProgress }
}

/** Saving and clearing settings: errors reach the caller (the inline form shows them). */
function usePluginConfigActions(reload: () => Promise<void>) {
  const saveConfig = useCallback(
    async (name: string, variable: string, value: string) => {
      await setPluginConfig(name, variable, value)
      await reload()
    },
    [reload],
  )
  const clearConfig = useCallback(
    async (name: string, variable: string) => {
      await deletePluginConfig(name, variable)
      await reload()
    },
    [reload],
  )
  return { saveConfig, clearConfig }
}

/**
 * Installed plugins and the catalog (Connections → Plugins, screen 05), with install
 * progress from `plugin-event` and the actions that change them. Each action reloads the
 * list afterwards; a failed install / update / remove / trust lands in `errorByName`.
 *
 * @returns Inventory data, per-plugin progress, operation and error, and the actions (PluginsState)
 */
export function usePlugins(): PluginsState {
  const inventoryState = useAsyncData(loadPluginInventory, [])
  const { reload } = inventoryState
  const { progressByName, clearProgress } = usePluginInstallProgress(reload)
  const { saveConfig, clearConfig } = usePluginConfigActions(reload)
  const [operationByName, setOperationByName] = useState<Record<string, PluginOperation>>({})
  const [errorByName, setErrorByName] = useState<Record<string, string>>({})

  const runOperation = useCallback(
    async (name: string, operation: PluginOperation, work: () => Promise<unknown>) => {
      setOperationByName((previous) => ({ ...previous, [name]: operation }))
      setErrorByName((previous) => withoutKey(previous, name))
      try {
        await work()
        await reload()
      } catch (operationError) {
        setErrorByName((previous) => ({ ...previous, [name]: `Could not ${operationVerbs[operation]} ${name}: ${describeError(operationError)}` }))
      } finally {
        setOperationByName((previous) => withoutKey(previous, name))
        clearProgress(name)
      }
    },
    [reload, clearProgress],
  )

  return {
    ...inventoryState,
    progressByName,
    operationByName,
    errorByName,
    install: (name) => runOperation(name, 'installing', () => installPlugin(name)),
    update: (name) => runOperation(name, 'updating', () => updatePlugin(name)),
    remove: (name) => runOperation(name, 'removing', () => removePlugin(name)),
    setTrusted: (name, trusted) => runOperation(name, 'trusting', () => setPluginTrusted(name, trusted)),
    saveConfig,
    clearConfig,
  }
}

/** The installed plugin with this name, or null (also while loading). */
export function findInstalledPlugin(inventory: PluginInventory | null, name: string): InstalledPlugin | null {
  return inventory?.installed.find((installedPlugin) => installedPlugin.name === name) ?? null
}
