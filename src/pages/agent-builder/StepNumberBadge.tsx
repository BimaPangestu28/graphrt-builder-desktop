import { joinClassNames } from '@/components/ui'

/** Visual role of a step's number badge: plain, approval (amber), or edited by the last chat change (brand). */
export type BuilderStepTone = 'plain' | 'approval' | 'changed'

const toneClassNames: Record<BuilderStepTone, string> = {
  plain: 'bg-canvas text-ink-2',
  approval: 'bg-amber-soft text-amber-strong',
  changed: 'bg-brand-soft text-brand-strong',
}

/** 26px round step number shown at the start of each step card (screens 03 and 04). */
export function StepNumberBadge({ number, tone = 'plain' }: { number: number; tone?: BuilderStepTone }) {
  return (
    <span className={joinClassNames('flex size-[26px] flex-[0_0_26px] items-center justify-center rounded-full text-[12px] font-semibold', toneClassNames[tone])}>
      {number}
    </span>
  )
}
