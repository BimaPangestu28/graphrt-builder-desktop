import type { FlowInput, FlowStep } from '../types'

/**
 * Renders sample steps as a graphrt workflow document, so the Source tab and version
 * history in the browser preview show something close to what the desktop stores.
 */

const sampleModelLines = ['      model: { provider: openai, name: gpt-4o-mini }', '      prompt: "{{#start.offer#}}"']

function quoteYaml(text: string): string {
  return JSON.stringify(text)
}

function renderNodeSpecificLines(flowStep: FlowStep, inputs: FlowInput[]): string[] {
  switch (flowStep.nodeType) {
    case 'start':
      return ['      variables:', ...inputs.map((input) => `        - { variable: ${input.name}, type: text-input, required: ${input.required} }`)]
    case 'llm':
      return sampleModelLines
    case 'human-input':
      return ['      actions:', '        - { id: approve, title: Approve }', '        - { id: skip, title: Skip }']
    case 'http-request':
      return ['      method: POST', '      url: "https://example.invalid/sample"']
    default:
      return []
  }
}

function findParentIterationId(steps: FlowStep[], stepIndex: number): string | null {
  for (let candidateIndex = stepIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (steps[candidateIndex].depth === 0) return steps[candidateIndex].id
  }
  return null
}

function renderNode(flowStep: FlowStep, steps: FlowStep[], stepIndex: number, inputs: FlowInput[]): string[] {
  const parentId = flowStep.depth > 0 ? findParentIterationId(steps, stepIndex) : null
  const nodeLines = [
    `    - id: ${flowStep.id}`,
    `      type: ${flowStep.nodeType}`,
    `      title: ${quoteYaml(flowStep.title)}`,
    `      desc: ${quoteYaml(flowStep.detail)}`,
    ...(parentId ? [`      parent: ${parentId}`] : []),
    ...renderNodeSpecificLines(flowStep, inputs),
  ]
  if (flowStep.nodeType === 'iteration') {
    nodeLines.push('', `    - id: ${flowStep.id}_start`, '      type: iteration-start', `      parent: ${flowStep.id}`)
  }
  return nodeLines
}

function renderEdges(steps: FlowStep[]): string[] {
  const edgeLines: string[] = []
  for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
    const previousStep = steps[stepIndex - 1]
    const currentStep = steps[stepIndex]
    const sourceId = previousStep.nodeType === 'iteration' && currentStep.depth > 0 ? `${previousStep.id}_start` : previousStep.id
    edgeLines.push(`    - { source: ${sourceId}, target: ${currentStep.id} }`)
  }
  return edgeLines
}

/**
 * Builds the graphrt document for a sample agent version.
 *
 * @param agentName - Agent name, written as the document `name` (string)
 * @param steps - Steps in order; depth-1 steps belong to the iteration before them (FlowStep[])
 * @param inputs - Inputs of the start node (FlowInput[])
 * @returns The workflow document as YAML text (string)
 */
export function renderSampleFlowYaml(agentName: string, steps: FlowStep[], inputs: FlowInput[]): string {
  const nodeBlocks = steps.map((flowStep, stepIndex) => renderNode(flowStep, steps, stepIndex, inputs).join('\n'))
  return [
    'version: "1"',
    `name: ${quoteYaml(agentName)}`,
    'graph:',
    '  nodes:',
    nodeBlocks.join('\n\n'),
    '',
    '  edges:',
    ...renderEdges(steps),
    '',
  ].join('\n')
}
