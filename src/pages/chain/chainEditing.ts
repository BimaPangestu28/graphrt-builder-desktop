import type { AgentStepInfo, ChainFailurePolicy, ChainInputMapping, ChainRunCondition, ChainStep } from '@/api/chainTypes'

/** Labels and pure edits behind screen 11 (chain of agents). */

export const runConditionOptions: Array<{ value: ChainRunCondition; label: (previousAgentName: string) => string; shortLabel: string }> = [
  { value: 'on_success', label: (previousAgentName) => `Only if ${previousAgentName} succeeded`, shortLabel: 'If it succeeded' },
  { value: 'always', label: () => 'Always, even if it failed', shortLabel: 'Always' },
]

export const failurePolicyOptions: Array<{ value: ChainFailurePolicy; label: string }> = [
  { value: 'stop', label: 'Stop the chain' },
  { value: 'continue', label: 'Skip it and keep going' },
]

/**
 * The short label on a link, e.g. "If it succeeded · places → leads".
 *
 * @param step - The step the link leads into (ChainStep)
 * @returns Condition plus every output mapping (string)
 */
export function describeChainLink(step: ChainStep): string {
  const conditionLabel = runConditionOptions.find((option) => option.value === step.runCondition)?.shortLabel ?? step.runCondition
  const outputMappings = step.inputs.flatMap((mapping) => (mapping.source.kind === 'output' ? [`${mapping.source.outputKey} → ${mapping.input}`] : []))
  return [conditionLabel, ...outputMappings].join(' · ')
}

/** Input names shown for a step: the agent's inputs, then any mapped name it no longer declares. */
export function listStepInputNames(step: ChainStep, agentStepInfo: AgentStepInfo | undefined): string[] {
  const declaredNames = agentStepInfo?.inputs.map((input) => input.name) ?? []
  const mappedNames = step.inputs.map((mapping) => mapping.input).filter((inputName) => !declaredNames.includes(inputName))
  return [...declaredNames, ...mappedNames]
}

/** Replaces (or with `null`, removes) the mapping of one input. */
export function setStepInputMapping(step: ChainStep, inputName: string, mapping: ChainInputMapping | null): ChainStep {
  const otherMappings = step.inputs.filter((existingMapping) => existingMapping.input !== inputName)
  if (!mapping) return { ...step, inputs: otherMappings }
  const existingIndex = step.inputs.findIndex((existingMapping) => existingMapping.input === inputName)
  if (existingIndex < 0) return { ...step, inputs: [...step.inputs, mapping] }
  return { ...step, inputs: step.inputs.map((existingMapping, index) => (index === existingIndex ? mapping : existingMapping)) }
}

/**
 * A new last step for `agentStepInfo`: each input reads the previous agent's output of the same name when
 * there is one, and runs only after a success.
 */
export function buildAppendedStep(agentStepInfo: AgentStepInfo, previousAgent: AgentStepInfo | undefined): ChainStep {
  const inputs: ChainInputMapping[] = agentStepInfo.inputs.flatMap((input) =>
    previousAgent?.outputs.includes(input.name) ? [{ input: input.name, source: { kind: 'output', outputKey: input.name } }] : [],
  )
  return { agentId: agentStepInfo.agentId, inputs, runCondition: 'on_success', onFailure: 'stop' }
}

/** Removes the step at `position`; a new first step keeps only its constant inputs. */
export function removeChainStep(steps: ChainStep[], position: number): ChainStep[] {
  const remainingSteps = steps.filter((_, index) => index !== position)
  return remainingSteps.map((step, index) =>
    index === 0 ? { ...step, inputs: step.inputs.filter((mapping) => mapping.source.kind === 'constant') } : step,
  )
}
