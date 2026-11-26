import { useId, useState } from 'react'
import { Spinner, StrokeIcon, VisuallyHidden, joinClassNames } from '@/components/ui'
import type { TestRunStepState } from '@/pages/agent-run/testRunTypes'
import { useLiveBrowserFrames } from '@/hooks/useLiveBrowserFrames'
import { LiveBrowserView } from './LiveBrowserView'
import { pickStepLiveViews } from './liveBrowserFrames'
import { formatDurationMs, formatElapsedClock } from './runProgress'
import type { RunStepView } from './runSteps'
import { StepDetails } from './StepDetails'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

const stepStateLabels: Readonly<Record<TestRunStepState, string>> = localizedRecord(() => messages().agentRun.stepStates)

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
    return <Spinner />
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
  const t = messages().agentRun
  if (step.state === 'done') return iteration.total === null ? t.countDone(iteration.doneCount) : t.positionOf(iteration.total, iteration.total)
  const position = iteration.total === null ? t.countDone(iteration.doneCount) : t.positionOf(iteration.currentNumber, iteration.total)
  return iteration.currentItemLabel ? `${position} · ${iteration.currentItemLabel}` : position
}

function describeStepMeta(step: RunStepView, now: number): string {
  const parts = [
    describeIterationMeta(step),
    step.state === 'waiting' && !step.iteration ? messages().agentRun.waitingForYou : null,
    step.detail ?? describeDuration(step, now),
    step.itemsDoneCount ? messages().agentRun.countDone(step.itemsDoneCount) : null,
    step.retryCount > 0 ? (step.retryCount === 1 ? messages().agentRun.n1Retry : messages().agentRun.retries(step.retryCount)) : null,
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
      aria-label={messages().agentRun.stepProgress(step.label)}
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
  fixAgentId?: string | null
  /** Live browser image under the running step; null = waiting for it; undefined = no live view. */
  liveImage?: string | null
}

function StepRow({ step, now, isExpanded, onToggle, fixAgentId, liveImage }: StepRowProps) {
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
      {liveImage !== undefined && (
        <div className="ml-[30px]">
          <LiveBrowserView image={liveImage} />
        </div>
      )}
      {isExpanded && (
        <div className="ml-[30px]">
          <StepDetails step={step} id={detailsId} fixAgentId={step.state === 'failed' ? fixAgentId : null} />
        </div>
      )}
    </li>
  )
}

interface StepProgressListProps {
  steps: RunStepView[]
  /** Current time in ms, for live durations (see `useNow`). */
  now?: number
  /** Agent whose builder "Ask the builder to fix this step" opens (prefilled) on a failed step. */
  fixAgentId?: string | null
}

/**
 * Ordered list of the agent's steps with their progress in a run (screens 06 and 20). Steps
 * inside an iteration are indented under it. Each row expands (click or Enter) to show what the
 * step did; the model step that is writing and a failed step open by themselves, and close
 * again when they finish unless the user opened or closed them. A running browser step (and a
 * running step whose browser tool is open) shows a live view of the page, never saved.
 */
export function StepProgressList({ steps, now = Date.now(), fixAgentId }: StepProgressListProps) {
  const [expandedByUser, setExpandedByUser] = useState<Record<string, boolean>>({})
  const liveFrames = useLiveBrowserFrames(steps.some((step) => step.state === 'running'))
  const liveViews = pickStepLiveViews(steps, liveFrames)
  return (
    <ol aria-label={messages().agentRun.steps} className="m-0 flex list-none flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      {steps.map((step) => {
        const isExpanded = expandedByUser[step.id] ?? isOpenByDefault(step)
        return (
          <StepRow
            key={step.id}
            step={step}
            now={now}
            isExpanded={isExpanded}
            fixAgentId={fixAgentId}
            liveImage={liveViews.get(step.id)}
            onToggle={() => setExpandedByUser((current) => ({ ...current, [step.id]: !isExpanded }))}
          />
        )
      })}
    </ol>
  )
}
