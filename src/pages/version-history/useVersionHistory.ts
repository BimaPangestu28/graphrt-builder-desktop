import { useState } from 'react'
import { agentVersions, initialChangeNotice, type AgentVersion } from '@/data/versionHistory'

/** The toast at the bottom: the latest change and the version it created, so it can be undone. */
export interface ChangeNotice {
  versionNumber: number
  message: string
}

function createRestoredVersion(restoredVersion: AgentVersion, newVersionNumber: number): AgentVersion {
  return {
    number: newVersionNumber,
    savedAt: 'Just now',
    summary: `Restored v${restoredVersion.number}`,
    origin: 'You, from history',
    steps: restoredVersion.steps,
  }
}

/**
 * Local state for screen 24: the version list (newest first, first is current),
 * which version is being previewed, and the undoable change notice.
 * Restoring never rewrites history; it adds a new version on top. Undo removes
 * the version the notice points at and makes the previous one current again.
 */
export function useVersionHistory() {
  const [versions, setVersions] = useState<AgentVersion[]>(agentVersions)
  const [selectedVersionNumber, setSelectedVersionNumber] = useState(5)
  const [changeNotice, setChangeNotice] = useState<ChangeNotice | null>(initialChangeNotice)

  const currentVersion = versions[0]
  const selectedVersion = versions.find((version) => version.number === selectedVersionNumber) ?? currentVersion
  const nextVersionNumber = currentVersion.number + 1

  function restoreSelectedVersion() {
    if (selectedVersion.number === currentVersion.number) return
    const restoredVersion = createRestoredVersion(selectedVersion, nextVersionNumber)
    setVersions([restoredVersion, ...versions])
    setSelectedVersionNumber(restoredVersion.number)
    setChangeNotice({ versionNumber: restoredVersion.number, message: `Restored v${selectedVersion.number} as v${restoredVersion.number}` })
  }

  function undoLastChange() {
    if (!changeNotice || versions.length < 2 || changeNotice.versionNumber !== currentVersion.number) {
      setChangeNotice(null)
      return
    }
    const remainingVersions = versions.slice(1)
    setVersions(remainingVersions)
    if (selectedVersionNumber === currentVersion.number) setSelectedVersionNumber(remainingVersions[0].number)
    setChangeNotice(null)
  }

  return {
    versions,
    currentVersion,
    selectedVersion,
    nextVersionNumber,
    changeNotice,
    selectVersion: setSelectedVersionNumber,
    showCurrentVersion: () => setSelectedVersionNumber(currentVersion.number),
    restoreSelectedVersion,
    undoLastChange,
  }
}
