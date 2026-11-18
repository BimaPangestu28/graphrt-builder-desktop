import { useState } from 'react'
import { StrokeIcon, joinClassNames } from '@/components/ui'
import { failedRun, type FailedRunStep, type FailedRunStepState } from '@/data/errorStates'

type RecoveryState = 'failed' | 'reconnected' | 'retryBlocked' | 'resumed'

const recoveryMessages: Partial<Record<RecoveryState, string>> = {
  reconnected: 'Gmail is connected again. Retry to finish the missed digest',
  retryBlocked: 'Gmail is still signed out, so the retry would fail again. Reconnect Gmail first',
  resumed: 'Resumed from Read new emails. The digest was sent to Telegram',
}

function StepMarker({ state }: { state: FailedRunStepState }) {
  if (state === 'done') {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok-strong">
        <StrokeIcon size={11} strokeWidth={3}>
          <path d="M5 12.5 10 17 19 7" />
        </StrokeIcon>
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span aria-hidden="true" className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
        !
      </span>
    )
  }
  return <span aria-hidden="true" className="box-border size-[18px] shrink-0 rounded-full border-2 border-line-strong" />
}

function RunStepList({ steps }: { steps: FailedRunStep[] }) {
  return (
    <ol aria-label="Run steps" className="m-0 flex list-none flex-col gap-0.5 p-0">
      {steps.map((step) => (
        <li
          key={step.id}
          className={joinClassNames(
            'flex items-center gap-2.5 py-2',
            step.state === 'failed' && '-mx-2.5 rounded-lg bg-danger-tint px-2.5',
            step.state === 'pending' && 'text-muted',
          )}
        >
          <StepMarker state={step.state} />
          <span className={joinClassNames(step.state === 'failed' && 'flex-auto font-semibold')}>{step.name}</span>
          {step.state === 'failed' && step.note && <span className="text-[12px] text-danger">{step.note}</span>}
        </li>
      ))}
    </ol>
  )
}

const allStepsDone: FailedRunStep[] = failedRun.steps.map((step) => ({ ...step, state: 'done', note: undefined }))

/** Left column of screen 23: the failed run, how to fix it, its steps and raw details. */
export function FailedRunPanel() {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('failed')
  const isGmailConnected = recoveryState === 'reconnected' || recoveryState === 'resumed'
  const steps = recoveryState === 'resumed' ? allStepsDone : failedRun.steps
  const recoveryMessage = recoveryMessages[recoveryState]

  function handleRetry() {
    setRecoveryState(isGmailConnected ? 'resumed' : 'retryBlocked')
  }

  return (
    <section aria-labelledby="failed-run-heading" className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-[22px] p-8">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <StrokeIcon size={22}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5M12 16.5v.01" />
          </StrokeIcon>
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">
            {failedRun.agentName} · {failedRun.startedAt}
          </span>
          <h1 id="failed-run-heading" className="m-0 text-[22px] font-semibold tracking-[-0.3px]">
            {failedRun.title}
          </h1>
          <p className="m-0 leading-[1.6] text-ink-2">{failedRun.explanation}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-line p-[18px]">
        <span className="font-semibold">Fix it</span>
        <ol className="m-0 flex flex-col gap-2.5 pl-5 leading-normal">
          {failedRun.fixSteps.map((fixStep) => (
            <li key={fixStep}>{fixStep}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isGmailConnected}
            onClick={() => setRecoveryState('reconnected')}
            className="h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-4 font-sans text-[14px] font-semibold text-white disabled:cursor-default disabled:bg-ok"
          >
            {isGmailConnected ? 'Gmail reconnected' : 'Reconnect Gmail'}
          </button>
          <button
            type="button"
            disabled={recoveryState === 'resumed'}
            onClick={handleRetry}
            className="h-10 cursor-pointer rounded-[9px] border border-line-strong bg-surface px-4 font-sans text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-50"
          >
            Retry from the failed step
          </button>
        </div>
        {recoveryMessage && (
          <p role="status" className={joinClassNames('m-0 text-[13px]', recoveryState === 'retryBlocked' ? 'text-danger' : 'text-ok-strong')}>
            {recoveryMessage}
          </p>
        )}
      </div>

      <RunStepList steps={steps} />

      <details className="rounded-xl border border-line px-4 py-3">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <pre className="m-0 mt-3 whitespace-pre-wrap font-mono text-[12px] leading-[1.6] text-ink-2">{failedRun.technicalDetails}</pre>
      </details>
    </section>
  )
}
