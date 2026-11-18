import { StrokeIcon, VisuallyHidden, joinClassNames } from '@/components/ui'
import type { TestRunStep, TestRunStepState } from '@/data/testRun'

const stepStateLabels: Record<TestRunStepState, string> = {
  done: 'Done',
  waiting: 'Waiting for you',
  pending: 'Not started',
}

function StepStateMarker({ state }: { state: TestRunStepState }) {
  if (state === 'done') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok-strong">
        <StrokeIcon size={12} strokeWidth={3}>
          <path d="M5 12.5 10 17 19 7" />
        </StrokeIcon>
      </span>
    )
  }
  if (state === 'waiting') {
    return <span aria-hidden="true" className="box-border size-5 shrink-0 rounded-full border-2 border-amber bg-amber-soft" />
  }
  return <span aria-hidden="true" className="box-border size-5 shrink-0 rounded-full border-2 border-line-strong" />
}

/** Ordered list of the agent's steps with their progress in the current test run. */
export function StepProgressList({ steps }: { steps: TestRunStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      {steps.map((step) => (
        <li key={step.id} className={joinClassNames('flex items-center gap-2.5', step.state === 'pending' && 'text-muted')}>
          <StepStateMarker state={step.state} />
          <span className={joinClassNames('flex-auto', step.state === 'waiting' && 'font-semibold')}>
            {step.label}
            <VisuallyHidden>, {stepStateLabels[step.state]}</VisuallyHidden>
          </span>
          {step.detail && <span className="text-[13px] text-body">{step.detail}</span>}
        </li>
      ))}
    </ol>
  )
}
