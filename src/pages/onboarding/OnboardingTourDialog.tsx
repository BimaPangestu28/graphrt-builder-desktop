import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Icon, buttonClassNames } from '@/components/ui'
import { TourIllustration } from './TourIllustrations'
import { TourStepDots } from './TourStepDots'
import { tourSteps, type TourStep } from './tourSteps'
import { useFocusOnOpenAndRestore } from './useDialogFocusTrap'
import { useTourKeyboard } from './useTourKeyboard'
import { messages } from '@/i18n'

/** How the tour ended: read to the last step, or closed early. */
export type TourOutcome = 'completed' | 'skipped'

interface OnboardingTourDialogProps {
  onClose: (outcome: TourOutcome) => void
  /** Defaults to the app's tour; tests may pass fewer steps. */
  steps?: readonly TourStep[]
}

function TourStepBody({ step, titleId, explanationId, onFollowTryLink }: { step: TourStep; titleId: string; explanationId: string; onFollowTryLink: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 text-[22px] font-semibold tracking-[-0.3px]">
        {step.title}
      </h2>
      <p id={explanationId} className="m-0 text-[14px] leading-[1.6] text-body">
        {step.explanation}
      </p>
      {step.tryLink && (
        <Link to={step.tryLink.path} onClick={onFollowTryLink} className="inline-flex w-fit items-center gap-1 font-semibold text-brand">
          {messages().misc.tryIt}{' '}{step.tryLink.label}
          <Icon name="arrowRight" size={14} />
        </Link>
      )}
    </div>
  )
}

/**
 * The onboarding tour: a modal dialog walking through what graphrt does, one short step at a
 * time. Back / Next (Done on the last step), Skip tour, step dots, ← and → to move, Escape to
 * close. Focus moves to the primary button on open, Tab stays inside, and focus returns to
 * where it was when the tour closes.
 */
export function OnboardingTourDialog({ onClose, steps = tourSteps }: OnboardingTourDialogProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const explanationId = useId()
  useFocusOnOpenAndRestore(primaryButtonRef)

  const currentStep = steps[currentStepIndex]
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === steps.length - 1
  const goToStep = (stepIndex: number) => setCurrentStepIndex(Math.min(Math.max(stepIndex, 0), steps.length - 1))
  const goForward = () => (isLastStep ? onClose('completed') : goToStep(currentStepIndex + 1))

  useTourKeyboard({
    dialogRef,
    onEscape: () => onClose('skipped'),
    onPrevious: () => goToStep(currentStepIndex - 1),
    onNext: () => goToStep(currentStepIndex + 1),
  })

  return (
    <div className="fixed inset-0 z-50 box-border flex items-center justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={explanationId}
        className="box-border flex w-full max-w-[520px] flex-col gap-5 rounded-[20px] bg-surface p-7 text-[14px] text-ink shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold text-brand-strong">
            {messages().misc.step}{' '}{currentStepIndex + 1} {messages().misc.of}{' '}{steps.length}
          </span>
          <button
            type="button"
            aria-label={messages().misc.closeTour}
            onClick={() => onClose('skipped')}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <TourIllustration stepId={currentStep.id} />
        <TourStepBody step={currentStep} titleId={titleId} explanationId={explanationId} onFollowTryLink={() => onClose('skipped')} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TourStepDots steps={steps} currentStepIndex={currentStepIndex} onSelectStep={goToStep} />
          <div className="flex items-center gap-2">
            {!isLastStep && (
              <Button variant="ghost" size="sm" onClick={() => onClose('skipped')}>
                {messages().misc.skipTour}
              </Button>
            )}
            {!isFirstStep && (
              <Button variant="secondary" size="sm" onClick={() => goToStep(currentStepIndex - 1)}>
                {messages().misc.back}
              </Button>
            )}
            <button ref={primaryButtonRef} type="button" onClick={goForward} className={buttonClassNames('primary', 'sm')}>
              {isLastStep ? messages().misc.done : messages().misc.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
