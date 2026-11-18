import type { FlowStep } from '@/api/types'
import type { StepChange } from '@/api/versionTypes'

/** One row of the "what changes if you restore" list. */
export type StepDiffRow =
  | { kind: 'unchanged'; step: FlowStep; position: number }
  | { kind: 'removed'; step: FlowStep }
  | { kind: 'added'; step: FlowStep }
  | { kind: 'changed'; step: FlowStep; fromSetting: string; toSetting: string }

const settingSeparator = ' · '

/**
 * Keeps only the parts of two details that differ, so "Uses the place name · max 2
 * sentences" vs "Uses the place name · max 4 sentences" reads "max 2 sentences → max 4 sentences".
 */
function describeDetailChange(currentDetail: string, restoredDetail: string) {
  const currentParts = currentDetail.split(settingSeparator).filter(Boolean)
  const restoredParts = restoredDetail.split(settingSeparator).filter(Boolean)
  const removedParts = currentParts.filter((part) => !restoredParts.includes(part))
  const addedParts = restoredParts.filter((part) => !currentParts.includes(part))
  return { fromSetting: removedParts.join(settingSeparator) || 'none', toSetting: addedParts.join(settingSeparator) || 'none' }
}

/** The "from → to" text of a changed step: its detail, else its title, else its type. */
function describeChangedStep(currentStep: FlowStep, restoredStep: FlowStep): StepDiffRow {
  if (currentStep.detail !== restoredStep.detail) {
    return { kind: 'changed', step: restoredStep, ...describeDetailChange(currentStep.detail, restoredStep.detail) }
  }
  if (currentStep.title !== restoredStep.title) {
    return { kind: 'changed', step: restoredStep, fromSetting: currentStep.title, toSetting: restoredStep.title }
  }
  return { kind: 'changed', step: restoredStep, fromSetting: currentStep.nodeType, toSetting: restoredStep.nodeType }
}

function toStepDiffRow(change: StepChange): StepDiffRow | null {
  const { before, after } = change
  switch (change.kind) {
    case 'added':
      return after && { kind: 'added', step: after }
    case 'removed':
      return before && { kind: 'removed', step: before }
    case 'changed':
      return before && after && describeChangedStep(before, after)
    case 'unchanged':
      return after && { kind: 'unchanged', step: after, position: change.position ?? 0 }
  }
}

/**
 * Turns the backend's step changes (current → version to restore) into the rows screen 24
 * shows. Order is the backend's; unchanged steps carry their position in the restored version.
 *
 * @param changes - `VersionComparison.changes` with `from` = current and `to` = restored (StepChange[])
 * @returns Display rows (StepDiffRow[])
 *
 * @example
 * toStepDiffRows((await compareAgentVersions('maps-leads', 7, 5)).changes)
 */
export function toStepDiffRows(changes: StepChange[]): StepDiffRow[] {
  return changes.map(toStepDiffRow).filter((row): row is StepDiffRow => row !== null)
}
