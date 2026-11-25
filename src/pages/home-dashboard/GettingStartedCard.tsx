import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Icon, joinClassNames } from '@/components/ui'
import { useOnboardingTour } from '@/pages/onboarding/onboardingTourContext'
import { gettingStartedDismissedKey, isGettingStartedComplete, type GettingStartedStep } from './gettingStarted'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(gettingStartedDismissedKey) === 'true'
  } catch {
    return false
  }
}

function saveDismissed(): void {
  try {
    window.localStorage.setItem(gettingStartedDismissedKey, 'true')
  } catch {
    // Storage blocked: the card hides for this visit only.
  }
}

interface StepTileProps {
  step: GettingStartedStep
  stepNumber: number
  isNext: boolean
}

/** The round marker: a check once done, the step number otherwise (filled for the next step). */
function StepMarker({ stepNumber, isDone, isNext }: { stepNumber: number; isDone: boolean; isNext: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={joinClassNames(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums',
        isDone && 'bg-ok-soft text-ok-strong',
        isNext && 'bg-amber-strong text-white',
        !isDone && !isNext && 'border border-line-strong text-muted',
      )}
    >
      {isDone ? <Icon name="check" size={12} /> : stepNumber}
    </span>
  )
}

/**
 * One step of the stepper: a row in the narrow list, a tile with the marker on top in the five
 * column row. A step still to do links to where it is done, and the whole tile is
 * clickable. The next one stands out with an amber tile and a "Next" chip, a done one is muted.
 */
function StepTile({ step, stepNumber, isNext }: StepTileProps) {
  return (
    <li
      className={joinClassNames(
        'relative flex min-w-0 items-center gap-2.5 rounded-[10px] border px-3 py-2.5 @min-[600px]:flex-col @min-[600px]:items-start @min-[600px]:gap-2',
        isNext ? 'border-amber-line bg-amber-tint' : 'border-line',
        !step.isDone && !isNext && 'hover:bg-subtle',
      )}
    >
      <StepMarker stepNumber={stepNumber} isDone={step.isDone} isNext={isNext} />
      <span className="flex min-w-0 flex-col">
        {step.isDone ? (
          <span title={step.label} className="line-clamp-2 text-[13px] text-muted">
            {step.label}
            <span className="sr-only"> (done)</span>
          </span>
        ) : (
          <Link
            to={step.path}
            title={step.label}
            className={joinClassNames(
              "line-clamp-2 text-[13px] !text-ink no-underline after:absolute after:inset-0 after:content-[''] hover:underline",
              isNext ? 'font-semibold' : 'font-medium',
            )}
          >
            {step.label}
          </Link>
        )}
        {isNext && <span className="text-[12px] font-medium text-amber-strong">Next</span>}
      </span>
    </li>
  )
}

/** "Take the tour" beside "Hide"; hidden outside the app's tour provider. */
function TakeTheTourButton() {
  const onboardingTour = useOnboardingTour()
  if (!onboardingTour) return null
  return (
    <Button variant="ghost" size="sm" onClick={onboardingTour.openTour} className="!text-brand hover:!text-brand-strong">
      <Icon name="info" size={14} />
      Take the tour
    </Button>
  )
}

function ProgressBar({ doneCount, totalCount }: { doneCount: number; totalCount: number }) {
  return (
    <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-chip">
      <span className="block h-full rounded-full bg-ok-strong" style={{ width: `${(doneCount / totalCount) * 100}%` }} />
    </span>
  )
}

/** Five tiles in a row (marker above the label) once the card is this wide (container query); a list below. */
const stepGridClassName = 'm-0 grid list-none grid-cols-1 gap-2 p-0 @min-[600px]:grid-cols-5'

/**
 * "Getting started" from a fresh install to a scheduled agent, as a horizontal stepper: every
 * step in order, done ones checked and the next one highlighted, with progress, "Take the tour"
 * and "Hide". Shown until every step is done; "Hide" keeps it away for this viewer
 * (localStorage, a UI convenience).
 *
 * @param steps - From `deriveGettingStartedSteps`, or null while loading (GettingStartedStep[] | null)
 */
export function GettingStartedCard({ steps }: { steps: GettingStartedStep[] | null }) {
  const [isDismissed, setIsDismissed] = useState(readDismissed)
  if (!steps || isDismissed || isGettingStartedComplete(steps)) return null
  const doneCount = steps.filter((step) => step.isDone).length
  const nextStepId = steps.find((step) => !step.isDone)?.id

  function handleDismiss() {
    saveDismissed()
    setIsDismissed(true)
  }

  return (
    <section aria-labelledby="home-getting-started" className="@container flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface px-5 py-4">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="home-getting-started" className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[16px] font-semibold">
          Getting started
          <ProgressBar doneCount={doneCount} totalCount={steps.length} />
          <span className="text-[13px] font-medium text-muted">
            {doneCount} of {steps.length} done
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <TakeTheTourButton />
          <Button variant="ghost" size="sm" onClick={handleDismiss} aria-label="Hide getting started">
            <Icon name="close" size={14} />
            Hide
          </Button>
        </div>
      </div>
      <ol className={stepGridClassName}>
        {steps.map((step, index) => (
          <StepTile key={step.id} step={step} stepNumber={index + 1} isNext={step.id === nextStepId} />
        ))}
      </ol>
    </section>
  )
}
