import { useEffect, useRef } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import type { AgentGraphController } from '../useAgentGraph'

/** Edits are saved this long after the last one (spec S1: every edit that compiles is a version). */
export const autosaveDelayMs = 1500

/**
 * Autosave policy of the Nodes view (spec S1): a moment after the last edit, the working copy
 * is saved as a new version. Nothing is sent while the builder is busy (the edits wait in the
 * queue and are merged when it is done), while saving, or while a conflict is open. An edit
 * the backend refused (problems, or another failure) is not sent again until it changes;
 * Save in the toolbar still saves at once.
 *
 * @param controller - The Nodes view's graph controller (AgentGraphController)
 * @param delayMs - Delay after the last edit; null turns autosave off (number | null)
 */
export function useGraphAutosave(controller: AgentGraphController, delayMs: number | null = autosaveDelayMs): void {
  const { graph, isDirty, builderBusy, status, save } = controller
  const attemptedGraphRef = useRef<AgentGraph | null>(null)
  const refusedGraphRef = useRef<AgentGraph | null>(null)

  useEffect(() => {
    if (status === 'invalid' || status === 'failed') refusedGraphRef.current = attemptedGraphRef.current
  }, [status])

  useEffect(() => {
    if (delayMs === null || !graph || !isDirty || builderBusy) return
    if (status === 'saving' || status === 'conflict' || refusedGraphRef.current === graph) return
    const timer = window.setTimeout(() => {
      attemptedGraphRef.current = graph
      save().catch((saveError: unknown) => console.warn('could not autosave the nodes edit', saveError))
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, graph, isDirty, builderBusy, status, save])
}
