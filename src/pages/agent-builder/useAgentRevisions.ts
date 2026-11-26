import { useState } from 'react'
import { restoreAgentVersion } from '@/api/agents'
import { reviseAgent, stopAgentRevision } from '@/api/builder'
import { isBackendErrorWithCode } from '@/api/client'
import { type BuildProgress, type BuildStage, type DraftPreview } from '@/api/types'
import { useIsMountedRef } from '@/hooks/useIsMountedRef'
import { describeError } from '@/lib/agentDisplay'
import { describeFailedChange } from './ChatBubbles'
import { messages } from '@/i18n'

/** One change request typed in the builder chat and what came of it. */
export interface ChatExchange {
  id: number
  request: string
  /** `stopped`: the user stopped it ("Stopped by you"), nothing was saved. */
  status: 'pending' | 'done' | 'failed' | 'stopped'
  /** Latest stage message while pending ("Updating the steps…"), the backend summary once done, or the error message when it failed. */
  reply: string
  changedStepIds: string[]
  /** The model's own words about the change: streamed while pending, final once done (may be empty). */
  explanation: string
  /** Latest preview of what the model is writing; kept after its round so the step titles stay visible. */
  draft: DraftPreview | null
  /** Stage of the progress update that carried a preview, or null when the latest update had none. */
  writingStage: BuildStage | null
  /** `nodes`: a save from the Nodes view ("Edited in Nodes: …"), with no request; `chat` when absent. */
  source?: 'chat' | 'nodes'
  /** Version the change created (Nodes saves). */
  versionAfter?: number
}

/** What a Nodes view save reports to the chat. */
export interface NodesEdit {
  summary: string
  changedStepIds: string[]
  versionBefore: number
  versionAfter: number
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
  /**
   * Called after any change is saved, to reload the agent and its steps. Gets the chat
   * exchange of a new revision, or null after Undo / Redo.
   */
  onAgentChanged: (savedExchangeId: number | null) => Promise<void>
}

/**
 * Chat changes on screen 04: Send calls `reviseAgent` (a new version), Stop cancels the
 * change in progress (`stopAgentRevision`: nothing is saved, "Stopped by you"), and Undo /
 * Redo restore the version before / after the last change (restoring also adds a version,
 * history is never rewritten).
 *
 * @returns Exchanges, the undoable revision, ids to highlight, and the actions
 */
export function useAgentRevisions({ agentId, currentVersion, onAgentChanged }: UseAgentRevisionsOptions) {
  const [exchanges, setExchanges] = useState<ChatExchange[]>([])
  const [latestRevision, setLatestRevision] = useState<LatestRevision | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  // A change keeps running in the backend after the builder screen closes; its
  // progress and result must not set state on the unmounted screen.
  const isMountedRef = useIsMountedRef()

  function updateExchange(exchangeId: number, changes: Partial<ChatExchange>) {
    if (!isMountedRef.current) return
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
    const pendingExchange: ChatExchange = { id: exchangeId, request, status: 'pending', reply: messages().builder.workingOnIt, changedStepIds: [], explanation: '', draft: null, writingStage: null }
    setExchanges((previousExchanges) => [...previousExchanges, pendingExchange])
    setIsBusy(true)
    try {
      const revision = await reviseAgent(agentId, request, (progress) => applyRevisionProgress(exchangeId, progress))
      await onAgentChanged(exchangeId)
      if (!isMountedRef.current) return
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
      if (isBackendErrorWithCode(revisionError, 'stopped')) {
        updateExchange(exchangeId, { status: 'stopped', reply: messages().lib.stoppedByYou, draft: null, writingStage: null })
        return
      }
      updateExchange(exchangeId, { status: 'failed', reply: describeFailedChange(describeError(revisionError)), draft: null, writingStage: null })
    } finally {
      if (isMountedRef.current) {
        setIsBusy(false)
        setIsStopping(false)
      }
    }
  }

  /** Stops the change in progress (its pending exchange then shows "Stopped by you"). */
  async function stopChangeRequest() {
    if (isStopping) return
    setIsStopping(true)
    try {
      const wasRunning = await stopAgentRevision(agentId)
      if (!wasRunning && isMountedRef.current) setIsStopping(false)
    } catch (stopError) {
      console.warn('could not stop the builder', stopError)
      if (isMountedRef.current) setIsStopping(false)
    }
  }

  async function toggleUndo() {
    if (!latestRevision || isBusy) return
    const restoredVersion = latestRevision.isUndone ? latestRevision.versionAfter : latestRevision.versionBefore
    setIsBusy(true)
    setUndoErrorMessage(null)
    try {
      await restoreAgentVersion(agentId, restoredVersion)
      await onAgentChanged(null)
      if (isMountedRef.current) setLatestRevision({ ...latestRevision, isUndone: !latestRevision.isUndone })
    } catch (undoError) {
      if (isMountedRef.current) setUndoErrorMessage(messages().builder.couldNotRestoreVRestoredversionReason(restoredVersion, describeError(undoError)))
    } finally {
      if (isMountedRef.current) setIsBusy(false)
    }
  }

  /** Notes a save from the Nodes view in the chat; it becomes the change Undo restores. */
  function recordNodesEdit(nodesEdit: NodesEdit) {
    const exchangeId = exchanges.length + 1
    const exchange: ChatExchange = {
      id: exchangeId,
      request: '',
      status: 'done',
      reply: nodesEdit.summary,
      changedStepIds: nodesEdit.changedStepIds,
      explanation: '',
      draft: null,
      writingStage: null,
      source: 'nodes',
      versionAfter: nodesEdit.versionAfter,
    }
    setExchanges((previousExchanges) => [...previousExchanges, exchange])
    setLatestRevision({ exchangeId, versionBefore: nodesEdit.versionBefore, versionAfter: nodesEdit.versionAfter, isUndone: false })
    setUndoErrorMessage(null)
  }

  const highlightedStepIds = new Set<string>()
  const latestExchange = exchanges.find((exchange) => exchange.id === latestRevision?.exchangeId)
  if (latestRevision && !latestRevision.isUndone && latestExchange) latestExchange.changedStepIds.forEach((stepId) => highlightedStepIds.add(stepId))

  return { exchanges, latestRevision, highlightedStepIds, isBusy, isStopping, undoErrorMessage, sendChangeRequest, stopChangeRequest, toggleUndo, recordNodesEdit }
}
