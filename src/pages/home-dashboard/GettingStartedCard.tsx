import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Icon, joinClassNames } from '@/components/ui'
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

function StepRow({ step, isNext }: { step: GettingStartedStep; isNext: boolean }) {
  return (
    <li className="flex items-center gap-3 border-b border-chip py-2.5 last:border-b-0">
      <span
        aria-hidden="true"
        className={joinClassNames(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
          step.isDone ? 'bg-ok-soft text-ok-strong' : 'border border-line-strong text-muted',
        )}
      >
        {step.isDone && <Icon name="check" size={12} />}
      </span>
      {step.isDone ? (
        <span className="flex-1 text-muted line-through">
          {step.label}
          <span className="sr-only"> (done)</span>
        </span>
      ) : (
        <Link to={step.path} className={joinClassNames('flex-1', isNext ? 'font-semibold' : 'font-medium')}>
          {step.label}
        </Link>
      )}
      {isNext && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[12px] text-amber-strong">Next</span>}
    </li>
  )
}

/**
 * "Getting started" checklist from a fresh install to a scheduled agent. Shown until every
 * step is done; "Hide" keeps it away for this viewer (localStorage, a UI convenience).
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
    <section aria-labelledby="home-getting-started" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-getting-started" className="m-0 flex items-center gap-2 text-[16px] font-semibold">
          Getting started
          <span className="text-[13px] font-medium text-muted">
            {doneCount} of {steps.length} done
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={handleDismiss} aria-label="Hide getting started">
          <Icon name="close" size={14} />
          Hide
        </Button>
      </div>
      <ol className="m-0 list-none p-0">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} isNext={step.id === nextStepId} />
        ))}
      </ol>
    </section>
  )
}
