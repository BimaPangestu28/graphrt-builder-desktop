import { useState } from 'react'
import { restoreAgentVersion } from '@/api/agents'
import { reviseAgent } from '@/api/builder'
import { describeError } from '@/lib/agentDisplay'

/** One change request typed in the builder chat and what came of it. */
export interface ChatExchange {
  id: number
  request: string
  status: 'pending' | 'done' | 'failed'
  /** Backend summary of the change, or the error message when it failed. */
  reply: string
  changedStepIds: string[]
}

/** The last successful change, so Undo/Redo can switch between its two versions. */
export interface LatestRevision {
  exchangeId: number
  versionBefore: number
  versionAfter: number
  isUndone: boolean
}

interface UseAgentRevisionsOptions {
  agentId: string
  /** Version the agent is on before the next change. */
  currentVersion: number | null
  /** Called after any change is saved, to reload the agent and its steps. */
  onAgentChanged: () => Promise<void>
}

/**
 * Chat changes on screen 04: Send calls `reviseAgent` (a new version), and Undo / Redo
 * restore the version before / after the last change (restoring also adds a version,
 * history is never rewritten).
 *
 * @returns Exchanges, the undoable revision, ids to highlight, and the actions
 */
export function useAgentRevisions({ agentId, currentVersion, onAgentChanged }: UseAgentRevisionsOptions) {
  const [exchanges, setExchanges] = useState<ChatExchange[]>([])
  const [latestRevision, setLatestRevision] = useState<LatestRevision | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null)

  function updateExchange(exchangeId: number, changes: Partial<ChatExchange>) {
    setExchanges((previousExchanges) => previousExchanges.map((exchange) => (exchange.id === exchangeId ? { ...exchange, ...changes } : exchange)))
  }

  async function sendChangeRequest(request: string) {
    if (isBusy || currentVersion === null) return
    const exchangeId = exchanges.length + 1
    setExchanges((previousExchanges) => [...previousExchanges, { id: exchangeId, request, status: 'pending', reply: 'Working on it…', changedStepIds: [] }])
    setIsBusy(true)
    try {
      const revision = await reviseAgent(agentId, request, (progress) => updateExchange(exchangeId, { reply: `${progress.message}…` }))
      await onAgentChanged()
      updateExchange(exchangeId, { status: 'done', reply: revision.summary, changedStepIds: revision.changedStepIds })
      setLatestRevision({ exchangeId, versionBefore: currentVersion, versionAfter: revision.agent.currentVersion, isUndone: false })
    } catch (revisionError) {
      updateExchange(exchangeId, { status: 'failed', reply: `Could not change the agent: ${describeError(revisionError)}` })
    } finally {
      setIsBusy(false)
    }
  }

  async function toggleUndo() {
    if (!latestRevision || isBusy) return
    const restoredVersion = latestRevision.isUndone ? latestRevision.versionAfter : latestRevision.versionBefore
    setIsBusy(true)
    setUndoErrorMessage(null)
    try {
      await restoreAgentVersion(agentId, restoredVersion)
      await onAgentChanged()
      setLatestRevision({ ...latestRevision, isUndone: !latestRevision.isUndone })
    } catch (undoError) {
      setUndoErrorMessage(`Could not restore v${restoredVersion}: ${describeError(undoError)}`)
    } finally {
      setIsBusy(false)
    }
  }

  const highlightedStepIds = new Set<string>()
  const latestExchange = exchanges.find((exchange) => exchange.id === latestRevision?.exchangeId)
  if (latestRevision && !latestRevision.isUndone && latestExchange) latestExchange.changedStepIds.forEach((stepId) => highlightedStepIds.add(stepId))

  return { exchanges, latestRevision, highlightedStepIds, isBusy, undoErrorMessage, sendChangeRequest, toggleUndo }
}
