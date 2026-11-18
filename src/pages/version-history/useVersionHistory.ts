import { useMemo, useState } from 'react'
import { restoreAgentVersion } from '@/api/agents'
import type { AgentVersion } from '@/api/types'
import { compareAgentVersions } from '@/api/versions'
import type { VersionComparison } from '@/api/versionTypes'
import { useAgentVersions } from '@/hooks/useAgentVersions'
import { useAsyncData, type AsyncDataState } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { formatSavedAt } from './formatSavedAt'

/** A saved version as screen 24 lists it. */
export interface VersionEntry {
  number: number
  savedAt: string
  summary: string
}

/** The toast at the bottom: the latest restore and, when it made a new version, the one it replaced. */
export interface ChangeNotice {
  message: string
  /** Version that was current before the restore; Undo restores it. Null when nothing changed. */
  previousVersionNumber: number | null
}

function toVersionEntry(agentVersion: AgentVersion): VersionEntry {
  return { number: agentVersion.version, savedAt: formatSavedAt(agentVersion.createdAt), summary: agentVersion.changeSummary }
}

/**
 * Loads what restoring `selectedVersionNumber` would change compared with the current
 * version, through `compareAgentVersions` (current = `from`, restored = `to`).
 */
function useRestoreComparison(agentId: string, currentVersionNumber: number | null, selectedVersionNumber: number | null): AsyncDataState<VersionComparison | null> {
  return useAsyncData(async () => {
    if (currentVersionNumber === null || selectedVersionNumber === null) return null
    return compareAgentVersions(agentId, currentVersionNumber, selectedVersionNumber)
  }, [agentId, currentVersionNumber, selectedVersionNumber])
}

/**
 * State for screen 24, backed by `listAgentVersions` and `compareAgentVersions`: the
 * versions (newest first, the first is current), which one is being previewed, its
 * comparison with the current version, and the undoable change notice. Restoring calls
 * `restoreAgentVersion`, which adds a new version on top (or nothing, when the steps are
 * already current); Undo restores the version that was current before.
 *
 * @param agentId - Agent whose history is shown (string)
 */
export function useVersionHistory(agentId: string) {
  const versionsState = useAgentVersions(agentId)
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null)
  const [changeNotice, setChangeNotice] = useState<ChangeNotice | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null)

  const versions = useMemo(() => (versionsState.data ?? []).map(toVersionEntry), [versionsState.data])
  const currentVersion = versions[0] ?? null
  // Until the user picks one, compare with the version before the current one.
  const defaultSelectedVersion = versions[1] ?? currentVersion
  const selectedVersion = versions.find((version) => version.number === selectedVersionNumber) ?? defaultSelectedVersion
  const nextVersionNumber = (currentVersion?.number ?? 0) + 1
  const comparisonState = useRestoreComparison(agentId, currentVersion?.number ?? null, selectedVersion?.number ?? null)

  async function restoreVersion(versionNumber: number): Promise<number | null> {
    setIsRestoring(true)
    setRestoreErrorMessage(null)
    try {
      const restoredAgent = await restoreAgentVersion(agentId, versionNumber)
      await versionsState.reload()
      setSelectedVersionNumber(restoredAgent.currentVersion)
      return restoredAgent.currentVersion
    } catch (restoreError) {
      setRestoreErrorMessage(`Could not restore v${versionNumber}: ${describeError(restoreError)}`)
      return null
    } finally {
      setIsRestoring(false)
    }
  }

  async function restoreSelectedVersion() {
    if (!currentVersion || !selectedVersion || selectedVersion.number === currentVersion.number || isRestoring) return
    const previousVersionNumber = currentVersion.number
    const newVersionNumber = await restoreVersion(selectedVersion.number)
    if (newVersionNumber === null) return
    if (newVersionNumber === previousVersionNumber) {
      setChangeNotice({ message: `v${selectedVersion.number} already matches the current version`, previousVersionNumber: null })
      return
    }
    setChangeNotice({ message: `Restored v${selectedVersion.number} as v${newVersionNumber}`, previousVersionNumber })
  }

  async function undoLastChange() {
    if (!changeNotice || changeNotice.previousVersionNumber === null || isRestoring) return
    const { previousVersionNumber } = changeNotice
    setChangeNotice(null)
    await restoreVersion(previousVersionNumber)
  }

  return {
    isLoading: versionsState.isLoading && !versionsState.data,
    loadError: versionsState.error,
    versions,
    currentVersion,
    selectedVersion,
    nextVersionNumber,
    comparison: comparisonState.data,
    isComparing: comparisonState.isLoading && !comparisonState.data,
    comparisonError: comparisonState.error,
    changeNotice,
    isRestoring,
    restoreErrorMessage,
    selectVersion: setSelectedVersionNumber,
    showCurrentVersion: () => {
      if (currentVersion) setSelectedVersionNumber(currentVersion.number)
    },
    restoreSelectedVersion,
    undoLastChange,
  }
}
