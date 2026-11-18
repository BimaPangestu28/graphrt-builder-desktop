import { joinClassNames } from '@/components/ui'
import type { BuilderStepTone } from '@/data/mapsLeadsAgent'

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
