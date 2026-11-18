import type { AgentStepSnapshot } from '@/data/versionHistory'

/** One row of the "what changes if you restore" list. */
export type StepDiffRow =
  | { kind: 'unchanged'; step: AgentStepSnapshot; position: number }
  | { kind: 'removed'; step: AgentStepSnapshot }
  | { kind: 'added'; step: AgentStepSnapshot }
  | { kind: 'changed'; step: AgentStepSnapshot; fromSetting: string; toSetting: string }

const settingSeparator = ' · '

/**
 * Keeps only the parts of two settings that differ, so "Uses the place name · max 2
 * sentences" vs "Uses the place name · max 4 sentences" reads "max 2 sentences → max 4 sentences".
 */
function describeSettingChange(currentSetting: string | undefined, restoredSetting: string | undefined) {
  const currentParts = (currentSetting ?? '').split(settingSeparator).filter(Boolean)
  const restoredParts = (restoredSetting ?? '').split(settingSeparator).filter(Boolean)
  const removedParts = currentParts.filter((part) => !restoredParts.includes(part))
  const addedParts = restoredParts.filter((part) => !currentParts.includes(part))
  return { fromSetting: removedParts.join(settingSeparator) || 'none', toSetting: addedParts.join(settingSeparator) || 'none' }
}

function describeChange(currentStep: AgentStepSnapshot, restoredStep: AgentStepSnapshot): StepDiffRow | null {
  if (currentStep.setting === restoredStep.setting && currentStep.name === restoredStep.name) return null
  if (currentStep.setting === restoredStep.setting) {
    return { kind: 'changed', step: restoredStep, fromSetting: currentStep.name, toSetting: restoredStep.name }
  }
  return { kind: 'changed', step: restoredStep, ...describeSettingChange(currentStep.setting, restoredStep.setting) }
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
