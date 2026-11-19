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

/** A step still to do: the next one stands out with a filled marker and a "Next" chip. */
function PendingStepRow({ step, isNext }: { step: GettingStartedStep; isNext: boolean }) {
  return (
    <li className={joinClassNames('flex items-center gap-2.5 rounded-[9px] px-2.5 py-1.5', isNext && 'bg-amber-tint')}>
      <span aria-hidden="true" className={joinClassNames('size-2 shrink-0 rounded-full', isNext ? 'bg-amber-strong' : 'border border-line-strong')} />
      <Link to={step.path} className={joinClassNames('flex-1', isNext ? 'font-semibold' : 'font-medium')}>
        {step.label}
      </Link>
      {isNext && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[12px] text-amber-strong">Next</span>}
    </li>
  )
}

/** Finished steps folded into one muted line, so the card stays short. */
function DoneStepsLine({ doneSteps }: { doneSteps: GettingStartedStep[] }) {
  if (doneSteps.length === 0) return null
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2.5 text-[13px] text-muted">
      <Icon name="check" size={12} className="text-ok-strong" />
      {doneSteps.map((step, index) => (
        <span key={step.id} className="line-through">
          {step.label}
          <span className="sr-only"> (done)</span>
          {index < doneSteps.length - 1 && <span aria-hidden="true"> ·</span>}
        </span>
      ))}
    </p>
  )
}

function ProgressBar({ doneCount, totalCount }: { doneCount: number; totalCount: number }) {
  return (
    <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-chip">
      <span className="block h-full rounded-full bg-ok-strong" style={{ width: `${(doneCount / totalCount) * 100}%` }} />
    </span>
  )
}

/**
 * "Getting started" checklist from a fresh install to a scheduled agent: the steps left (the
 * next one highlighted) and the finished ones folded into one line. Shown until every step is
 * done; "Hide" keeps it away for this viewer (localStorage, a UI convenience).
 *
 * @param steps - From `deriveGettingStartedSteps`, or null while loading (GettingStartedStep[] | null)
 */
export function GettingStartedCard({ steps }: { steps: GettingStartedStep[] | null }) {
  const [isDismissed, setIsDismissed] = useState(readDismissed)
  if (!steps || isDismissed || isGettingStartedComplete(steps)) return null
  const doneSteps = steps.filter((step) => step.isDone)
  const pendingSteps = steps.filter((step) => !step.isDone)
  const nextStepId = pendingSteps[0]?.id

  function handleDismiss() {
    saveDismissed()
    setIsDismissed(true)
  }

  return (
    <section aria-labelledby="home-getting-started" className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface px-[18px] py-3.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id="home-getting-started" className="m-0 flex items-center gap-2.5 text-[16px] font-semibold">
          Getting started
          <ProgressBar doneCount={doneSteps.length} totalCount={steps.length} />
          <span className="text-[13px] font-medium text-muted">
            {doneSteps.length} of {steps.length} done
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={handleDismiss} aria-label="Hide getting started">
          <Icon name="close" size={14} />
          Hide
        </Button>
      </div>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {pendingSteps.map((step) => (
          <PendingStepRow key={step.id} step={step} isNext={step.id === nextStepId} />
        ))}
      </ol>
      <DoneStepsLine doneSteps={doneSteps} />
    </section>
  )
}
