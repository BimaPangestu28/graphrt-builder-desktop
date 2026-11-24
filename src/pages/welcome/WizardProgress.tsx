import { joinClassNames } from '@/components/ui'
import { wizardStepLabels, type WizardStepId } from './welcomeWizard'

interface WizardProgressProps {
  steps: readonly WizardStepId[]
  currentStepId: WizardStepId
}

/**
 * "Step 2 of 5" with one bar segment per step: done and current segments are filled, the
 * current one is marked `aria-current="step"`. Not clickable, so a step cannot be skipped.
 */
export function WizardProgress({ steps, currentStepId }: WizardProgressProps) {
  const currentIndex = steps.indexOf(currentStepId)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold text-brand-strong">
        Step {currentIndex + 1} of {steps.length}
      </span>
      <ol aria-label="Setup progress" className="m-0 grid list-none gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((stepId, stepIndex) => {
          const isCurrent = stepIndex === currentIndex
          const isDone = stepIndex < currentIndex
          return (
            <li key={stepId} aria-current={isCurrent ? 'step' : undefined} className="flex flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={joinClassNames('h-1.5 rounded-full transition-colors motion-reduce:transition-none', isCurrent ? 'bg-ink' : isDone ? 'bg-brand' : 'bg-line')}
              />
              <span className={joinClassNames('truncate text-[11px]', isCurrent ? 'font-semibold text-ink' : 'text-muted')}>
                <span className="sr-only">{isDone ? 'Done: ' : isCurrent ? 'Current: ' : ''}</span>
                {wizardStepLabels[stepId]}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
