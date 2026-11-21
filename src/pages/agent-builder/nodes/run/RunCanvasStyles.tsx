import { useMemo } from 'react'
import type { GraphProblem } from '@/api/agentGraphTypes'
import type { EdgeRunState } from './nodeRunStates'

/**
 * Arrow styles for the live run and for problems, as a scoped stylesheet keyed by React Flow's
 * `data-id` on each edge, so the canvas code (`toFlowEdges`) stays untouched (spec 44: taken
 * arrows darken, a taken error path turns solid red, skipped paths fade; spec 37: a problem
 * arrow is red and dashed).
 */

/** Wrapper the rules are scoped to (the canvas container in `NodesView`). */
export const runCanvasScopeAttribute = 'data-nodes-canvas'

const edgeRules: Record<EdgeRunState, string> = {
  taken: 'stroke: var(--color-ink-2) !important; stroke-width: 2px !important; stroke-dasharray: none !important;',
  'error-taken': 'stroke: var(--color-danger) !important; stroke-width: 2.5px !important; stroke-dasharray: none !important;',
  skipped: 'opacity: 0.35;',
}

const problemEdgeRule = 'stroke: var(--color-danger) !important; stroke-dasharray: 6 4 !important;'

function escapeAttributeValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}

function edgeSelector(edgeId: string, part: string): string {
  return `[${runCanvasScopeAttribute}] .react-flow__edge[data-id="${escapeAttributeValue(edgeId)}"]${part}`
}

/**
 * The stylesheet text (exported for tests).
 *
 * @param edgeStates - Arrow states of the shown run by edge id (Record<string, EdgeRunState>)
 * @param problems - Problems; those with an `edgeId` mark that arrow (GraphProblem[])
 */
export function buildRunCanvasCss(edgeStates: Record<string, EdgeRunState>, problems: GraphProblem[]): string {
  const rules: string[] = []
  for (const problem of problems) {
    if (problem.edgeId && problem.severity === 'error') rules.push(`${edgeSelector(problem.edgeId, ' .react-flow__edge-path')} { ${problemEdgeRule} }`)
  }
  for (const [edgeId, edgeState] of Object.entries(edgeStates)) {
    const part = edgeState === 'skipped' ? '' : ' .react-flow__edge-path'
    rules.push(`${edgeSelector(edgeId, part)} { ${edgeRules[edgeState]} }`)
  }
  return rules.join('\n')
}

export function RunCanvasStyles({ edgeStates, problems }: { edgeStates: Record<string, EdgeRunState>; problems: GraphProblem[] }) {
  const css = useMemo(() => buildRunCanvasCss(edgeStates, problems), [edgeStates, problems])
  if (!css) return null
  return <style data-testid="run-canvas-styles">{css}</style>
}
