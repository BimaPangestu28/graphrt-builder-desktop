import { joinClassNames } from '@/components/ui'
import type { TourStep } from './tourSteps'
import { messages } from '@/i18n'

interface TourStepDotsProps {
  steps: readonly TourStep[]
  currentStepIndex: number
  onSelectStep: (stepIndex: number) => void
}

/** One dot per step; the current one is wider and marked `aria-current="step"`. */
export function TourStepDots({ steps, currentStepIndex, onSelectStep }: TourStepDotsProps) {
  return (
    <ol aria-label={messages().misc.tourSteps} className="m-0 flex list-none items-center gap-1.5 p-0">
      {steps.map((step, stepIndex) => {
        const isCurrent = stepIndex === currentStepIndex
        return (
          <li key={step.id} className="flex">
            <button
              type="button"
              aria-label={messages().misc.stepValueTitle(stepIndex + 1, step.title)}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelectStep(stepIndex)}
              className={joinClassNames(
                'h-2 cursor-pointer rounded-full border-0 p-0 transition-[width,background-color] duration-200 motion-reduce:transition-none',
                isCurrent ? 'w-5 bg-ink' : 'w-2 bg-line-heavy hover:bg-faint',
              )}
            />
          </li>
        )
      })}
    </ol>
  )
}
