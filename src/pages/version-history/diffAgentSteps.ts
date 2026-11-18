import type { AgentStepSnapshot } from '@/data/versionHistory'

/** One row of the "what changes if you restore" list. */
export type StepDiffRow =
  | { kind: 'unchanged'; step: AgentStepSnapshot; position: number }
  | { kind: 'removed'; step: AgentStepSnapshot }
  | { kind: 'added'; step: AgentStepSnapshot }
  | { kind: 'changed'; step: AgentStepSnapshot; fromSetting: string; toSetting: string }

function describeChange(currentStep: AgentStepSnapshot, restoredStep: AgentStepSnapshot): StepDiffRow | null {
  if (currentStep.setting === restoredStep.setting) return null
  return {
    kind: 'changed',
    step: restoredStep,
    fromSetting: currentStep.setting ?? 'none',
    toSetting: restoredStep.setting ?? 'none',
  }
}

/**
 * Lists what happens to the current steps if `restoredSteps` replaces them.
 * Rows follow the current order; steps only in the restored version are inserted
 * after the step that precedes them there. Unchanged steps are numbered by their
 * position in the restored version.
 *
 * @param currentSteps - Steps of the current version (AgentStepSnapshot[])
 * @param restoredSteps - Steps of the version being previewed (AgentStepSnapshot[])
 * @returns Ordered diff rows (StepDiffRow[])
 *
 * @example
 * diffAgentSteps(v7.steps, v5.steps) // [..., { kind: 'removed', step: qualifyLead }, ...]
 */
export function diffAgentSteps(currentSteps: AgentStepSnapshot[], restoredSteps: AgentStepSnapshot[]): StepDiffRow[] {
  const restoredById = new Map(restoredSteps.map((step, index) => [step.id, { step, index }]))
  const currentIds = new Set(currentSteps.map((step) => step.id))
  const diffRows: StepDiffRow[] = []

  const appendAddedStepsAfter = (restoredIndex: number) => {
    for (let nextIndex = restoredIndex + 1; nextIndex < restoredSteps.length; nextIndex += 1) {
      const nextStep = restoredSteps[nextIndex]
      if (currentIds.has(nextStep.id)) return
      diffRows.push({ kind: 'added', step: nextStep })
    }
  }

  appendAddedStepsAfter(-1)
  for (const currentStep of currentSteps) {
    const restoredMatch = restoredById.get(currentStep.id)
    if (!restoredMatch) {
      diffRows.push({ kind: 'removed', step: currentStep })
      continue
    }
    const changeRow = describeChange(currentStep, restoredMatch.step)
    diffRows.push(changeRow ?? { kind: 'unchanged', step: restoredMatch.step, position: restoredMatch.index + 1 })
    appendAddedStepsAfter(restoredMatch.index)
  }
  return diffRows
}

/** True when restoring would change nothing. */
export function isDiffEmpty(diffRows: StepDiffRow[]): boolean {
  return diffRows.every((row) => row.kind === 'unchanged')
}
