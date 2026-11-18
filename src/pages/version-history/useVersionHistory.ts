import { useMemo, useState } from 'react'
import { restoreAgentVersion } from '@/api/agents'
import type { AgentVersion } from '@/api/types'
import type { AgentStepSnapshot } from '@/data/versionHistory'
import { useAgentVersions } from '@/hooks/useAgentVersions'
import { describeError } from '@/lib/agentDisplay'
import { formatSavedAt } from './formatSavedAt'
import { readStepSnapshots } from './readFlowSteps'

/** A saved version as screen 24 shows it. */
export interface VersionEntry {
  number: number
  savedAt: string
  summary: string
  steps: AgentStepSnapshot[]
}

/** The toast at the bottom: the latest restore and the version it replaced, so it can be undone. */
export interface ChangeNotice {
  message: string
  /** Version that was current before the restore; Undo restores it. */
  previousVersionNumber: number
}

function toVersionEntry(agentVersion: AgentVersion): VersionEntry {
  return {
    number: agentVersion.version,
    savedAt: formatSavedAt(agentVersion.createdAt),
    summary: agentVersion.changeSummary,
    steps: readStepSnapshots(agentVersion.flowYaml),
  }
}

/**
 * State for screen 24, backed by `listAgentVersions`: the versions (newest first, the
 * first is current), which one is being previewed, and the undoable change notice.
 * Restoring calls `restoreAgentVersion`, which adds a new version on top; Undo
 * restores the version that was current before, again as a new version.
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
    setChangeNotice({ message: `Restored v${selectedVersion.number} as v${newVersionNumber}`, previousVersionNumber })
  }

  async function undoLastChange() {
    if (!changeNotice || isRestoring) return
    const undoneNotice = changeNotice
    setChangeNotice(null)
    await restoreVersion(undoneNotice.previousVersionNumber)
  }

  return {
    isLoading: versionsState.isLoading && !versionsState.data,
    loadError: versionsState.error,
    versions,
    currentVersion,
    selectedVersion,
    nextVersionNumber,
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
