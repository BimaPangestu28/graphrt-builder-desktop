import type { FlowStep } from '@/api/types'
import { joinClassNames } from '@/components/ui'
import type { BuilderStepTone } from '@/data/mapsLeadsAgent'
import { StepNumberBadge } from './StepNumberBadge'

interface BuilderStepCardProps {
  flowStep: FlowStep
  /** 1-based position in the flow. */
  number: number
  /** True right after a chat change touched this step (until it is undone). */
  isChanged: boolean
}

function getStepTone(flowStep: FlowStep, isChanged: boolean): BuilderStepTone {
  if (isChanged) return 'changed'
  if (flowStep.needsApproval) return 'approval'
  return 'plain'
}

/** One step row in the builder's Steps tab (screen 04). Steps inside a loop (depth 1+) are indented. */
export function BuilderStepCard({ flowStep, number, isChanged }: BuilderStepCardProps) {
  return (
    <li
      className={joinClassNames(
        'flex items-start gap-3.5 rounded-xl border bg-surface px-4 py-3.5',
        isChanged ? 'border-brand' : 'border-line',
        flowStep.depth > 0 && 'ml-6',
      )}
    >
      <StepNumberBadge number={number} tone={getStepTone(flowStep, isChanged)} />
      <div className="flex flex-auto flex-col gap-1">
        <span className="font-semibold">{flowStep.title}</span>
        {flowStep.detail && <span className="text-[13px] text-body">{flowStep.detail}</span>}
        {isChanged && <span className="text-[12px] font-medium text-brand-strong">Changed just now</span>}
      </div>
      {flowStep.needsApproval && <span className="rounded-full bg-amber-soft px-2 py-[3px] text-[12px] font-medium text-amber-strong">Approval</span>}
    </li>
  )
}
