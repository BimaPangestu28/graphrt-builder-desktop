import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getFailedRunReport } from '@/api/problems'
import type { FailedRunReport, FailedRunStep, FailedRunStepState, ProblemAction } from '@/api/problemTypes'
import { StrokeIcon, joinClassNames } from '@/components/ui'
import { useLoadedData } from '@/hooks/useRunData'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { routePaths } from '@/routes'
import { CommandOutcomeMessage, ProblemActionControl, type CommandOutcome } from './ProblemActionControl'
import { messages } from '@/i18n'

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
    <ol aria-label={messages().agentRun.runSteps} className="m-0 flex list-none flex-col gap-0.5 p-0">
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

function retryAction(report: FailedRunReport): ProblemAction {
  return { kind: 'retry_run', label: messages().agentRun.retryFromTheStart, agentId: report.agentId, runId: report.runId }
}

/** The "Fix it" box: what to do, the button that fixes the cause, and a retry from the start. */
function FixItBox({ report }: { report: FailedRunReport }) {
  const [commandOutcome, setCommandOutcome] = useState<CommandOutcome | null>(null)
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line p-[18px]">
      <span className="font-semibold">{messages().agentRun.fixIt}</span>
      <ol className="m-0 flex flex-col gap-2.5 pl-5 leading-normal">
        {report.fixSteps.map((fixStep) => (
          <li key={fixStep}>{fixStep}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {report.fixAction && <ProblemActionControl action={report.fixAction} style="primary" onCommandFinished={setCommandOutcome} />}
        {report.retry.canRetry && commandOutcome?.kind !== 'done' && (
          <ProblemActionControl action={retryAction(report)} style="secondary" onCommandFinished={setCommandOutcome} />
        )}
      </div>
      {!report.retry.canRetry && report.retry.reason && <p className="m-0 text-[13px] text-body">{messages().agentRun.retryIsNotAvailable}{' '}{report.retry.reason}</p>}
      {commandOutcome && <CommandOutcomeMessage outcome={commandOutcome} />}
    </div>
  )
}

function FailedRunIcon() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
      <StrokeIcon size={22}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </StrokeIcon>
    </span>
  )
}

function FailedRunReportView({ report }: { report: FailedRunReport }) {
  return (
    <>
      <div className="flex items-start gap-4">
        <FailedRunIcon />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">
            {report.agentName} · {formatRunDay(report.startedAt, new Date())}
          </span>
          <h1 id="failed-run-heading" className="m-0 text-[22px] font-semibold tracking-[-0.3px]">
            {report.title}
          </h1>
          <p className="m-0 leading-[1.6] text-ink-2">{report.explanation}</p>
        </div>
      </div>
      <FixItBox key={report.runId} report={report} />
      <RunStepList steps={report.steps} />
      <details className="rounded-xl border border-line px-4 py-3">
        <summary className="cursor-pointer font-medium">{messages().agentRun.technicalDetails}</summary>
        <pre className="m-0 mt-3 whitespace-pre-wrap font-mono text-[12px] leading-[1.6] text-ink-2">{report.technicalDetails}</pre>
      </details>
    </>
  )
}

function NoFailedRun({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 id="failed-run-heading" className="m-0 text-[22px] font-semibold tracking-[-0.3px]">
        {messages().agentRun.noFailedRuns}
      </h1>
      <p className="m-0 leading-[1.6] text-ink-2">{message}</p>
      <Link to={routePaths.runs}>{messages().agentRun.seeEveryRun}</Link>
    </div>
  )
}

/** Left column of screen 23: one failed run, how to fix it, its steps and graphrt's error. */
export function FailedRunPanel({ runId }: { runId: string | null }) {
  const { data: report, error, isLoading } = useLoadedData(() => (runId ? getFailedRunReport(runId) : Promise.resolve(null)), [runId])
  return (
    <section aria-labelledby="failed-run-heading" className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-[22px] p-8">
      {!runId && <NoFailedRun message={messages().agentRun.theLatestRunOfEveryAgent} />}
      {runId && error && <NoFailedRun message={messages().agentRun.couldNotLoadRun(error.message)} />}
      {runId && !error && isLoading && !report && <p className="m-0 text-body">{messages().agentRun.loadingTheRun}</p>}
      {runId && report && <FailedRunReportView report={report} />}
    </section>
  )
}
