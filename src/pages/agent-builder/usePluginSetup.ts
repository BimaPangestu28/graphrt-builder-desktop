import { useCallback, useEffect, useRef, useState } from 'react'
import { checkPluginSession, installPlugin, listAgentPluginRequirements, listenToPluginEvents, setPluginConfig, setPluginTrusted } from '@/api/plugins'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { PluginEvent } from '@/api/pluginTypes'
import { useBackendSubscription } from '@/hooks/useBackendSubscription'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { toInstallProgress } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { describeInstallProgress } from '../plugins/pluginDisplay'
import { arePluginRequirementsReady, needsOnlySessionLink, needsPluginApproval } from './pluginRequirementDisplay'

/** Browser runtime download as the setup card shows it. */
export interface BrowserDownloadState {
  isDownloading: boolean
  /** Latest progress line, e.g. "Downloading Chromium · 40%". */
  progressText: string | null
  errorMessage: string | null
}

/** What the plugin setup card in the build chat reads and does. */
export interface PluginSetupState {
  /** Null while loading, before the agent exists, or when loading failed. */
  requirements: PluginRequirement[] | null
  loadError: Error | null
  /** Every plugin can run; null while not known yet. */
  isReady: boolean | null
  /** Loads the requirements again and resolves to them (null when loading failed). */
  reload: () => Promise<PluginRequirement[] | null>
  /** Install progress line per plugin while it downloads and verifies. */
  progressByName: Record<string, string>
  /** Plugins whose install / trust approval is running. */
  approvingNames: string[]
  /** Last failed approval per plugin, as text to show. */
  errorByName: Record<string, string>
  isApprovingAll: boolean
  browserDownload: BrowserDownloadState
  /** Installs the plugin when missing, then trusts it when it asks for secrets. */
  approvePlugin: (name: string) => Promise<void>
  /** Approves every plugin that still needs it, one after the other. */
  approveAllPlugins: () => Promise<void>
  /** Saves a setting to the keychain; rejects with the error so the input can show it. */
  saveSetting: (name: string, variable: string, value: string) => Promise<void>
  downloadBrowser: () => Promise<void>
}

/** Loads `listAgentPluginRequirements`; answers that arrive after a newer request are dropped. */
function usePluginRequirementsLoader(agentId: string | null) {
  const [requirements, setRequirements] = useState<PluginRequirement[] | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const latestRequestIdRef = useRef(0)

  const reload = useCallback(async (): Promise<PluginRequirement[] | null> => {
    latestRequestIdRef.current += 1
    const requestId = latestRequestIdRef.current
    if (agentId === null) return null
    try {
      const loadedRequirements = await listAgentPluginRequirements(agentId)
      if (requestId === latestRequestIdRef.current) {
        setRequirements(loadedRequirements)
        setLoadError(null)
      }
      return loadedRequirements
    } catch (rawError) {
      console.error(`Could not list the plugins agent ${agentId} needs`, rawError)
      if (requestId === latestRequestIdRef.current) setLoadError(rawError instanceof Error ? rawError : new Error(describeError(rawError)))
      return null
    }
  }, [agentId])

  useEffect(() => {
    setRequirements(null)
    setLoadError(null)
    void reload()
    return () => {
      latestRequestIdRef.current += 1
    }
  }, [reload])

  return { requirements, loadError, reload }
}

/**
 * Asks each plugin that only lacks its account link (whatsapp-web) once whether it is linked
 * after all: the stored state may be stale or never checked (linked before this app version,
 * or on Connections). Reloads the requirements when one turns out linked. Failures are logged:
 * the "Needs" row keeps offering the QR link.
 */
function useStaleSessionCheck(requirements: PluginRequirement[] | null, reload: () => Promise<unknown>) {
  const checkedNamesRef = useRef(new Set<string>())
  useEffect(() => {
    const uncheckedNames = (requirements ?? []).filter(needsOnlySessionLink).map((requirement) => requirement.name).filter((name) => !checkedNamesRef.current.has(name))
    for (const pluginName of uncheckedNames) {
      checkedNamesRef.current.add(pluginName)
      checkPluginSession(pluginName)
        .then((sessionState) => (sessionState === 'linked' ? reload() : undefined))
        .catch((checkError: unknown) => console.error(`Could not check the ${pluginName} session`, checkError))
    }
  }, [requirements, reload])
}

function withoutKey<Value>(record: Record<string, Value>, key: string): Record<string, Value> {
  const remaining = { ...record }
  delete remaining[key]
  return remaining
}

/** Install progress per plugin from `plugin-event`; any other plugin change reloads the requirements. */
function useInstallProgressLines(reload: () => Promise<unknown>) {
  const [progressByName, setProgressByName] = useState<Record<string, string>>({})
  const handlePluginEvent = useCallback(
    (pluginEvent: PluginEvent) => {
      if (pluginEvent.type === 'install_progress') {
        setProgressByName((previous) => ({ ...previous, [pluginEvent.name]: describeInstallProgress(toInstallProgress(pluginEvent)) }))
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

/** Install, then trust when needed, for one requirement. */
async function installAndTrust(requirement: PluginRequirement): Promise<void> {
  if (!requirement.installed) await installPlugin(requirement.name)
  if (!requirement.trusted && !requirement.trustNotNeeded) await setPluginTrusted(requirement.name, true)
}

/** The approvals (one plugin or all of them) with their busy and error state. */
function usePluginApprovals(requirements: PluginRequirement[] | null, reload: () => Promise<unknown>, clearProgress: (name: string) => void) {
  const [approvingNames, setApprovingNames] = useState<string[]>([])
  const [errorByName, setErrorByName] = useState<Record<string, string>>({})
  const [isApprovingAll, setIsApprovingAll] = useState(false)

  const approveRequirement = useCallback(
    async (requirement: PluginRequirement) => {
      setApprovingNames((previous) => [...previous, requirement.name])
      setErrorByName((previous) => withoutKey(previous, requirement.name))
      try {
        await installAndTrust(requirement)
      } catch (approvalError) {
        setErrorByName((previous) => ({ ...previous, [requirement.name]: `Could not set up ${requirement.name}: ${describeError(approvalError)}` }))
      } finally {
        setApprovingNames((previous) => previous.filter((name) => name !== requirement.name))
        clearProgress(requirement.name)
      }
    },
    [clearProgress],
  )

  const approvePlugin = useCallback(
    async (name: string) => {
      const requirement = requirements?.find((candidate) => candidate.name === name)
      if (!requirement || !needsPluginApproval(requirement)) return
      await approveRequirement(requirement)
      await reload()
    },
    [requirements, approveRequirement, reload],
  )

  const approveAllPlugins = useCallback(async () => {
    setIsApprovingAll(true)
    try {
      for (const requirement of (requirements ?? []).filter(needsPluginApproval)) await approveRequirement(requirement)
      await reload()
    } finally {
      setIsApprovingAll(false)
    }
  }, [requirements, approveRequirement, reload])

  return { approvingNames, errorByName, isApprovingAll, approvePlugin, approveAllPlugins }
}

/**
 * What an agent needs from plugins (`listAgentPluginRequirements`) and the actions that
 * complete it from the build chat: install & trust, settings, the browser runtime. Every
 * action reloads the requirements, so the card and the "Needs" panel stay in sync.
 *
 * @param agentId - The agent, or null before the build saved it (nothing loads then) (string | null)
 * @returns Requirements, progress, errors and actions (PluginSetupState)
 */
export function usePluginSetup(agentId: string | null): PluginSetupState {
  const { requirements, loadError, reload } = usePluginRequirementsLoader(agentId)
  useStaleSessionCheck(requirements, reload)
  const { progressByName, clearProgress } = useInstallProgressLines(reload)
  const approvals = usePluginApprovals(requirements, reload, clearProgress)
  const browserRuntime = useBrowserRuntime()
  const installBrowserRuntime = browserRuntime.install

  const saveSetting = useCallback(
    async (name: string, variable: string, value: string) => {
      await setPluginConfig(name, variable, value)
      await reload()
    },
    [reload],
  )

  const downloadBrowser = useCallback(async () => {
    await installBrowserRuntime()
    await reload()
  }, [installBrowserRuntime, reload])

  return {
    requirements,
    loadError,
    isReady: requirements ? arePluginRequirementsReady(requirements) : null,
    reload,
    progressByName,
    ...approvals,
    browserDownload: { isDownloading: browserRuntime.isInstalling, progressText: browserRuntime.progressText, errorMessage: browserRuntime.installError },
    saveSetting,
    downloadBrowser,
  }
}
