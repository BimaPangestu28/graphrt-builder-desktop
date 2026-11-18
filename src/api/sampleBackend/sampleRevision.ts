import type { FlowStep } from '../types'

/**
 * Turns a chat instruction into a plausible step change for the sample builder,
 * using a few keyword rules ("shorter", "wait 30 seconds", "fewer than 50 reviews").
 * Anything else is applied to the first model step as a note.
 */

export interface SampleRevisionPlan {
  steps: FlowStep[]
  changedStepIds: string[]
  summary: string
}

const detailSeparator = ' · '
const maxNoteLength = 48

function splitDetail(detail: string): string[] {
  return detail.split(detailSeparator).filter(Boolean)
}

function readFirstNumber(instruction: string, fallback: number): number {
  const numberMatch = instruction.match(/\d+/)
  return numberMatch ? Number(numberMatch[0]) : fallback
}

function shortenMessage(flowStep: FlowStep): FlowStep {
  const segments = splitDetail(flowStep.detail)
  const lengthIndex = segments.findIndex((segment) => /^max \d+ sentences?$/.test(segment))
  const currentLimit = lengthIndex >= 0 ? readFirstNumber(segments[lengthIndex], 3) : 3
  const newLimit = Math.max(1, currentLimit - 1)
  const lengthSegment = `max ${newLimit} ${newLimit === 1 ? 'sentence' : 'sentences'}`
  if (lengthIndex >= 0) segments[lengthIndex] = lengthSegment
  else segments.push(lengthSegment)
  return { ...flowStep, detail: segments.join(detailSeparator) }
}

function addSendingGap(flowStep: FlowStep, gapSeconds: number): FlowStep {
  const segments = splitDetail(flowStep.detail)
  const gapSegment = `${gapSeconds}s gap`
  const gapIndex = segments.findIndex((segment) => /^\d+s gap$/.test(segment))
  if (gapIndex >= 0) segments[gapIndex] = gapSegment
  else segments.splice(Math.min(1, segments.length), 0, gapSegment)
  return { ...flowStep, detail: segments.join(detailSeparator) }
}

function addNote(flowStep: FlowStep, instruction: string): FlowStep {
  const note = instruction.length > maxNoteLength ? `${instruction.slice(0, maxNoteLength - 1)}…` : instruction
  const [firstSegment] = splitDetail(flowStep.detail)
  return { ...flowStep, detail: firstSegment ? `${firstSegment}${detailSeparator}${note}` : note }
}

function insertReviewFilter(steps: FlowStep[], minimumReviews: number): { steps: FlowStep[]; addedStep: FlowStep } {
  const loopIndex = steps.findIndex((flowStep) => flowStep.nodeType === 'iteration')
  const addedStep: FlowStep = {
    id: 'skip_few_reviews',
    nodeType: 'if-else',
    title: `Skip places with fewer than ${minimumReviews} reviews`,
    detail: 'Checked before writing a message',
    needsApproval: false,
    depth: loopIndex >= 0 ? 1 : 0,
  }
  const insertIndex = loopIndex >= 0 ? loopIndex + 1 : Math.min(1, steps.length)
  return { steps: [...steps.slice(0, insertIndex), addedStep, ...steps.slice(insertIndex)], addedStep }
}

function replaceStep(steps: FlowStep[], changedStep: FlowStep): FlowStep[] {
  return steps.map((flowStep) => (flowStep.id === changedStep.id ? changedStep : flowStep))
}

function describeChanges(addedTitles: string[], changedTitles: string[]): string {
  const parts: string[] = []
  if (addedTitles.length > 0) parts.push(`Added ${addedTitles.join(', ')}`)
  if (changedTitles.length > 0) parts.push(`Changed ${changedTitles.length} ${changedTitles.length === 1 ? 'step' : 'steps'}: ${changedTitles.join(', ')}`)
  return parts.join('. ')
}

/**
 * Plans the sample change for an instruction.
 *
 * @param steps - Current steps (FlowStep[]); not mutated
 * @param instruction - What the user typed in the builder chat (string)
 * @returns New steps, the ids of added or changed steps, and a plain-words summary (SampleRevisionPlan)
 *
 * @example
 * planSampleRevision(steps, 'Make the message shorter').changedStepIds // ['write_message']
 */
export function planSampleRevision(steps: FlowStep[], instruction: string): SampleRevisionPlan {
  let revisedSteps = steps
  const changedStepIds: string[] = []
  const addedTitles: string[] = []
  const changedTitles: string[] = []
  const modelStep = steps.find((flowStep) => flowStep.nodeType === 'llm') ?? steps[steps.length - 1]
  const sendingStep = [...steps].reverse().find((flowStep) => flowStep.nodeType === 'http-request')

  function recordChange(changedStep: FlowStep) {
    revisedSteps = replaceStep(revisedSteps, changedStep)
    changedStepIds.push(changedStep.id)
    changedTitles.push(changedStep.title)
  }

  if (/review/i.test(instruction)) {
    const insertion = insertReviewFilter(revisedSteps, readFirstNumber(instruction, 50))
    revisedSteps = insertion.steps
    changedStepIds.push(insertion.addedStep.id)
    addedTitles.push(insertion.addedStep.title)
  }
  if (modelStep && /short|brief|concise/i.test(instruction)) recordChange(shortenMessage(modelStep))
  if (sendingStep && /wait|gap|second|slow/i.test(instruction)) recordChange(addSendingGap(sendingStep, readFirstNumber(instruction, 30)))
  if (changedStepIds.length === 0 && modelStep) recordChange(addNote(modelStep, instruction))

  return { steps: revisedSteps, changedStepIds, summary: describeChanges(addedTitles, changedTitles) }
}
