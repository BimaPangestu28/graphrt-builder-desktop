import type { AgentGraph, GraphProblem } from '@/api/agentGraphTypes'

/**
 * Plain-words display of the validation problems (`GraphProblem.code`, stable codes from
 * `agent_graph::problem_codes`) for the canvas chips and the Problems panel (spec E,
 * artboard 37), plus the "Fix with builder" request and the reason Test is off.
 */

const problemLabels: Record<string, string> = {
  unreadable_document: 'Cannot be read',
  unknown_reference: 'Uses a missing step',
  cross_scope_edge: 'Arrow crosses a loop',
  cycle: 'Goes in a circle',
  entry: 'No single start',
  node_config: 'Settings need fixing',
  compile: 'Cannot run',
  unreachable: 'Not connected',
  compile_warning: 'Check this',
  send_without_approval: 'Sends without asking',
  placeholder_address: 'Placeholder address',
  model_provider_not_set_up: 'Model not connected',
  model_capability: 'Model can’t do this',
  unused_edge: 'Arrow never taken',
  plugin_not_installed: 'Plugin not installed',
}

/** A config path named in a problem message (`url`, "tool_parameters.city"), if any. */
function fieldNamedIn(message: string): string | null {
  const quoted = message.match(/[`'"]([A-Za-z_][A-Za-z0-9_.]*)[`'"]/)
  return quoted ? quoted[1] : null
}

/**
 * The part of the inspector a problem is about, for "Show node": the error path for an
 * arrow that is never taken, the model for a model that is not connected, the field a
 * settings problem names. Null when it is about the step as a whole.
 *
 * @param problem - The problem (GraphProblem)
 * @returns An inspector section target (`InspectorSectionTarget`), or null (string | null)
 *
 * @example
 * inspectorTargetForProblem({ code: 'node_config', message: 'missing `url`', … }) // 'url'
 */
export function inspectorTargetForProblem(problem: GraphProblem): string | null {
  if (problem.code === 'unused_edge') return 'on-error'
  if (problem.code === 'model_provider_not_set_up' || problem.code === 'model_capability') return 'model'
  if (problem.code === 'node_config' || problem.code === 'placeholder_address') return fieldNamedIn(problem.message)
  return null
}

/** Short chip text: "Not connected", "Settings need fixing". */
export function describeProblemLabel(problem: GraphProblem): string {
  return problemLabels[problem.code] ?? (problem.severity === 'error' ? 'Problem' : 'Check this')
}

/** The step a problem is about: its title, or null for problems of the whole agent. */
export function problemNodeTitle(problem: GraphProblem, graph: AgentGraph): string | null {
  if (problem.nodeId) return graph.nodes.find((node) => node.id === problem.nodeId)?.displayTitle ?? problem.nodeId
  if (problem.edgeId) {
    const edge = graph.edges.find((candidate) => candidate.id === problem.edgeId)
    return edge ? (graph.nodes.find((node) => node.id === edge.source)?.displayTitle ?? edge.source) : null
  }
  return null
}

/** The node to show for a problem: its own, or the source of its arrow. */
export function problemTargetNodeId(problem: GraphProblem, graph: AgentGraph): string | null {
  if (problem.nodeId) return problem.nodeId
  return graph.edges.find((edge) => edge.id === problem.edgeId)?.source ?? null
}

/**
 * The change request "Fix with builder" puts in the chat box (the user reads and sends it).
 *
 * @example
 * buildFixRequest(problem, graph) // "Fix Send WhatsApp message: … is not reachable from the start, so it never runs"
 */
export function buildFixRequest(problem: GraphProblem, graph: AgentGraph): string {
  const title = problemNodeTitle(problem, graph)
  return title ? `Fix ${title}: ${problem.message}` : `Fix this problem: ${problem.message}`
}

/** Errors first, then warnings, each in the order they came. */
export function sortProblems(problems: GraphProblem[]): GraphProblem[] {
  return [...problems.filter((problem) => problem.severity === 'error'), ...problems.filter((problem) => problem.severity !== 'error')]
}

/** Problems with the same code, step, arrow and message are listed once (a load's and a refused save's). */
export function dedupeProblems(problems: GraphProblem[]): GraphProblem[] {
  const seen = new Set<string>()
  return problems.filter((problem) => {
    const key = JSON.stringify([problem.code, problem.nodeId, problem.edgeId, problem.message])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Problems by the node they are shown on. */
export function groupProblemsByNode(problems: GraphProblem[], graph: AgentGraph): Record<string, GraphProblem[]> {
  const grouped: Record<string, GraphProblem[]> = {}
  for (const problem of problems) {
    const nodeId = problemTargetNodeId(problem, graph)
    if (!nodeId) continue
    grouped[nodeId] = [...(grouped[nodeId] ?? []), problem]
  }
  return grouped
}

export interface TestBlock {
  /** Plain words, on the Test button's tooltip and under the problems. */
  reason: string
  /** True turns Test off; false (plugins not set up) lets Test bring the setup card up. */
  isBlocking: boolean
}

/**
 * Why Test is off, or null when it can start (spec 45: "Test is off while the builder works,
 * and while an edit can't be saved: 1 problem, File is empty in Send…").
 */
export function describeTestBlock(options: { problems: GraphProblem[]; graph: AgentGraph; builderBusy: boolean; isSaving: boolean; arePluginsReady: boolean }): TestBlock | null {
  const { problems, graph, builderBusy, isSaving, arePluginsReady } = options
  const errors = problems.filter((problem) => problem.severity === 'error')
  const problemPart = errors.length > 0 ? describeFirstError(errors, graph) : null
  if (builderBusy) {
    const reason = problemPart ? `Test is off while the builder works, and while an edit can't be saved: ${problemPart}` : 'Test is off while the builder works'
    return { reason, isBlocking: true }
  }
  if (problemPart) return { reason: `Test is off until this is fixed: ${problemPart}`, isBlocking: true }
  if (isSaving) return { reason: 'Test waits until your edit is saved', isBlocking: true }
  if (!arePluginsReady) return { reason: 'Set up the plugins this agent needs first', isBlocking: false }
  return null
}

function describeFirstError(errors: GraphProblem[], graph: AgentGraph): string {
  const count = errors.length === 1 ? '1 problem' : `${errors.length} problems`
  const title = problemNodeTitle(errors[0], graph)
  return `${count}, ${describeProblemLabel(errors[0])}${title ? ` in ${title}` : ''}`
}
