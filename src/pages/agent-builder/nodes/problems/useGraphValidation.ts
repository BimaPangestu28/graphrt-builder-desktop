import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { validateAgentGraph } from '@/api/agentGraph'
import type { AgentGraph, GraphProblem } from '@/api/agentGraphTypes'
import { toGraphEdit } from '../graphEdits'
import type { AgentGraphController } from '../useAgentGraph'
import { dedupeProblems } from './problemDisplay'

/** Local edits are checked this long after the last one (the backend compiles them like a save). */
export const validationDelayMs = 500

export interface GraphValidation {
  /** Problems of the working copy: the latest check of these edits, else the load's, plus a refused save's. */
  problems: GraphProblem[]
  isValidating: boolean
  /** True after Validate was clicked, until the next edit. */
  wasValidated: boolean
  /** Checks the working copy now (Validate). */
  validate: () => Promise<GraphProblem[]>
  validationError: Error | null
}

/**
 * Keeps the problems of the working copy current: edits are checked with `validate_agent_graph`
 * a moment after the last one (nothing is saved), and Validate checks right away.
 *
 * @param controller - The Nodes view's graph controller (AgentGraphController)
 * @param agentId - Agent (string)
 * @returns Problems, the Validate action and its state (GraphValidation)
 */
export function useGraphValidation(controller: AgentGraphController, agentId: string): GraphValidation {
  const { graph, savedGraph, isDirty, saveProblems } = controller
  const [checked, setChecked] = useState<{ graph: AgentGraph; problems: GraphProblem[] } | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [validatedGraph, setValidatedGraph] = useState<AgentGraph | null>(null)
  const [validationError, setValidationError] = useState<Error | null>(null)
  const latestRequestRef = useRef(0)

  const check = useCallback(
    async (graphToCheck: AgentGraph, baseVersion: number) => {
      latestRequestRef.current += 1
      const requestId = latestRequestRef.current
      setIsValidating(true)
      try {
        const problems = await validateAgentGraph(agentId, baseVersion, toGraphEdit(graphToCheck))
        if (requestId === latestRequestRef.current) {
          setChecked({ graph: graphToCheck, problems })
          setValidationError(null)
        }
        return problems
      } catch (rawError) {
        if (requestId === latestRequestRef.current) setValidationError(rawError instanceof Error ? rawError : new Error(String(rawError)))
        return []
      } finally {
        if (requestId === latestRequestRef.current) setIsValidating(false)
      }
    },
    [agentId],
  )

  useEffect(() => {
    if (!graph || !savedGraph || !isDirty) return
    const timer = window.setTimeout(() => void check(graph, savedGraph.version), validationDelayMs)
    return () => window.clearTimeout(timer)
  }, [graph, savedGraph, isDirty, check])

  const validate = useCallback(async () => {
    if (!graph || !savedGraph) return []
    setValidatedGraph(graph)
    return check(graph, savedGraph.version)
  }, [graph, savedGraph, check])

  const problems = useMemo(() => {
    const current = checked && checked.graph === graph ? checked.problems : (graph?.problems ?? [])
    return dedupeProblems([...current, ...saveProblems])
  }, [checked, graph, saveProblems])

  return { problems, isValidating, wasValidated: validatedGraph !== null && validatedGraph === graph, validate, validationError }
}
