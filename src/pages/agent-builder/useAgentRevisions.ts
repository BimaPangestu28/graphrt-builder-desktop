import { useState } from 'react'
import { restoreAgentVersion } from '@/api/agents'
import { reviseAgent } from '@/api/builder'
import type { BuildProgress, BuildStage, DraftPreview } from '@/api/types'
import { describeError } from '@/lib/agentDisplay'

/** One change request typed in the builder chat and what came of it. */
export interface ChatExchange {
  id: number
  request: string
  status: 'pending' | 'done' | 'failed'
  /** Latest stage message while pending ("Updating the steps…"), the backend summary once done, or the error message when it failed. */
  reply: string
  changedStepIds: string[]
  /** The model's own words about the change: streamed while pending, final once done (may be empty). */
  explanation: string
  /** Latest preview of what the model is writing; kept after its round so the step titles stay visible. */
  draft: DraftPreview | null
  /** Stage of the progress update that carried a preview, or null when the latest update had none. */
  writingStage: BuildStage | null
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

  function applyRevisionProgress(exchangeId: number, progress: BuildProgress) {
    const reply = `${progress.message}…`
    if (!progress.draft) {
      updateExchange(exchangeId, { reply, writingStage: null })
      return
    }
    updateExchange(exchangeId, { reply, draft: progress.draft, explanation: progress.draft.explanation, writingStage: progress.stage })
  }

  async function sendChangeRequest(request: string) {
    if (isBusy || currentVersion === null) return
    const exchangeId = exchanges.length + 1
    const pendingExchange: ChatExchange = { id: exchangeId, request, status: 'pending', reply: 'Working on it…', changedStepIds: [], explanation: '', draft: null, writingStage: null }
    setExchanges((previousExchanges) => [...previousExchanges, pendingExchange])
    setIsBusy(true)
    try {
      const revision = await reviseAgent(agentId, request, (progress) => applyRevisionProgress(exchangeId, progress))
      await onAgentChanged()
      updateExchange(exchangeId, {
        status: 'done',
        reply: revision.summary,
        changedStepIds: revision.changedStepIds,
        explanation: revision.explanation.trim(),
        draft: null,
        writingStage: null,
      })
      setLatestRevision({ exchangeId, versionBefore: currentVersion, versionAfter: revision.agent.currentVersion, isUndone: false })
    } catch (revisionError) {
      updateExchange(exchangeId, { status: 'failed', reply: `Could not change the agent: ${describeError(revisionError)}`, draft: null, writingStage: null })
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
