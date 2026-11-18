import { useId, useState } from 'react'
import { StrokeIcon, VisuallyHidden, joinClassNames } from '@/components/ui'
import type { TestRunStepState } from '@/data/testRun'
import { formatDurationMs, formatElapsedClock } from './runProgress'
import type { RunStepView } from './runSteps'
import { StepDetails } from './StepDetails'

const stepStateLabels: Record<TestRunStepState, string> = {
  done: 'Done',
  running: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  skipped: 'Skipped',
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
  if (state === 'running') {
    return <span aria-hidden="true" className="box-border size-5 shrink-0 rounded-full border-2 border-brand bg-brand-soft motion-safe:animate-pulse" />
  }
  if (state === 'failed') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
        <StrokeIcon size={12} strokeWidth={3}>
          <path d="M7 7l10 10M17 7 7 17" />
        </StrokeIcon>
      </span>
    )
  }
  if (state === 'waiting') {
    return <span aria-hidden="true" className="box-border size-5 shrink-0 rounded-full border-2 border-amber bg-amber-soft" />
  }
  return <span aria-hidden="true" className="box-border size-5 shrink-0 rounded-full border-2 border-line-strong" />
}

function describeDuration(step: RunStepView, now: number): string | null {
  if (step.state === 'running' && step.startedAt) return formatElapsedClock(now - new Date(step.startedAt).getTime())
  return step.durationMs === null ? null : formatDurationMs(step.durationMs)
}

/** "3 of 10 · Kopi Kenangan" while an iteration runs; "3 done" when the total is not known. */
export function describeIterationMeta(step: RunStepView): string | null {
  const iteration = step.iteration
  if (!iteration || iteration.currentNumber === null) return null
  if (step.state === 'done') return iteration.total === null ? `${iteration.doneCount} done` : `${iteration.total} of ${iteration.total}`
  const position = iteration.total === null ? `${iteration.doneCount} done` : `${iteration.currentNumber} of ${iteration.total}`
  return iteration.currentItemLabel ? `${position} · ${iteration.currentItemLabel}` : position
}

function describeStepMeta(step: RunStepView, now: number): string {
  const parts = [
    describeIterationMeta(step),
    step.state === 'waiting' && !step.iteration ? 'waiting for you' : null,
    step.detail ?? describeDuration(step, now),
    step.itemsDoneCount ? `${step.itemsDoneCount} done` : null,
    step.retryCount > 0 ? (step.retryCount === 1 ? '1 retry' : `${step.retryCount} retries`) : null,
  ]
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

function IterationBar({ step }: { step: RunStepView }) {
  const iteration = step.iteration
  if (!iteration || iteration.total === null || iteration.total === 0) return null
  const percent = Math.min(100, Math.round((iteration.doneCount / iteration.total) * 100))
  return (
    <div
      role="progressbar"
      aria-label={`${step.label} progress`}
      aria-valuemin={0}
      aria-valuemax={iteration.total}
      aria-valuenow={iteration.doneCount}
      className="ml-[30px] h-1 overflow-hidden rounded-full bg-chip"
    >
      <div className="h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Opened by default: the model step that is writing, and a failed step (not its container). */
function isOpenByDefault(step: RunStepView): boolean {
  return (step.isModelStep && step.state === 'running') || (step.state === 'failed' && step.iteration === null)
}

interface StepRowProps {
  step: RunStepView
  now: number
  isExpanded: boolean
  onToggle: () => void
  fixPath?: string | null
}

function StepRow({ step, now, isExpanded, onToggle, fixPath }: StepRowProps) {
  const detailsId = useId()
  const meta = describeStepMeta(step, now)
  const isMuted = step.state === 'pending' || step.state === 'skipped'
  return (
    <li className="flex flex-col gap-1.5" style={{ paddingLeft: step.depth * 24 }}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? detailsId : undefined}
        onClick={onToggle}
        className={joinClassNames(
          '-mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-[14px] text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand',
          isMuted && 'text-muted',
        )}
      >
        <StepStateMarker state={step.state} />
        <span className={joinClassNames('flex-auto', step.state === 'waiting' && 'font-semibold')}>
          {step.label}
          <VisuallyHidden>, {stepStateLabels[step.state]}</VisuallyHidden>
        </span>
        {meta && <span className="text-right text-[13px] text-body">{meta}</span>}
        <StrokeIcon size={14} className={joinClassNames('shrink-0 text-muted motion-safe:transition-transform', isExpanded && 'rotate-90')}>
          <path d="m9 6 6 6-6 6" />
        </StrokeIcon>
      </button>
      <IterationBar step={step} />
      {isExpanded && (
        <div className="ml-[30px]">
          <StepDetails step={step} id={detailsId} fixPath={step.state === 'failed' ? fixPath : null} />
        </div>
      )}
    </li>
  )
}

interface StepProgressListProps {
  steps: RunStepView[]
  /** Current time in ms, for live durations (see `useNow`). */
  now?: number
  /** Where "Ask the builder to fix this step" goes on a failed step. */
  fixPath?: string | null
}

/**
 * Ordered list of the agent's steps with their progress in a run (screens 06 and 20). Steps
 * inside an iteration are indented under it. Each row expands (click or Enter) to show what the
 * step did; the model step that is writing and a failed step open by themselves, and close
 * again when they finish unless the user opened or closed them.
 */
export function StepProgressList({ steps, now = Date.now(), fixPath }: StepProgressListProps) {
  const [expandedByUser, setExpandedByUser] = useState<Record<string, boolean>>({})
  return (
    <ol aria-label="Steps" className="m-0 flex list-none flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      {steps.map((step) => {
        const isExpanded = expandedByUser[step.id] ?? isOpenByDefault(step)
        return (
          <StepRow
            key={step.id}
            step={step}
            now={now}
            isExpanded={isExpanded}
            fixPath={fixPath}
            onToggle={() => setExpandedByUser((current) => ({ ...current, [step.id]: !isExpanded }))}
          />
        )
      })}
    </ol>
  )
}
