import { joinClassNames } from '@/components/ui'
import type { BuilderStep, BuilderStepTone } from '@/data/mapsLeadsAgent'
import { StepNumberBadge } from './StepNumberBadge'

interface BuilderStepCardProps {
  step: BuilderStep
  /** False after Undo, so changed steps show their previous version without the highlight. */
  showsLatestChange: boolean
}

function getStepTone(step: BuilderStep, isHighlightedAsChanged: boolean): BuilderStepTone {
  if (isHighlightedAsChanged) return 'changed'
  if (step.isApproval) return 'approval'
  return 'plain'
}

/** One step row in the builder's Steps tab (screen 04). */
export function BuilderStepCard({ step, showsLatestChange }: BuilderStepCardProps) {
  const isHighlightedAsChanged = Boolean(step.previousVersion) && showsLatestChange
  const visibleVersion = !showsLatestChange && step.previousVersion ? step.previousVersion : step

  return (
    <li
      className={joinClassNames(
        'flex items-start gap-3.5 rounded-xl border bg-surface px-4 py-3.5',
        isHighlightedAsChanged ? 'border-brand' : 'border-line',
        step.isInsideLoop && 'ml-6',
      )}
    >
      <StepNumberBadge number={step.number} tone={getStepTone(step, isHighlightedAsChanged)} />
      <div className="flex flex-auto flex-col gap-1">
        <span className="font-semibold">{visibleVersion.title}</span>
        <span className="text-[13px] text-body">{visibleVersion.detail}</span>
        {isHighlightedAsChanged && <span className="text-[12px] font-medium text-brand-strong">Changed just now</span>}
      </div>
      {step.isApproval && <span className="rounded-full bg-amber-soft px-2 py-[3px] text-[12px] font-medium text-amber-strong">Approval</span>}
    </li>
  )
}
