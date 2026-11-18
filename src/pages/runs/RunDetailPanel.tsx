import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StrokeIcon, joinClassNames } from '@/components/ui'
import type { RunRecord, RunStep } from '@/data/runs'
import { agentPath, routePaths } from '@/routes'

interface RunDetailPanelProps {
  run: RunRecord
  onClose: () => void
}

const outlineActionClassNames =
  'inline-flex h-9 cursor-pointer items-center rounded-[9px] border border-line-strong bg-surface px-3.5 text-[13px] font-medium no-underline !text-ink hover:bg-subtle'

function StepIndicator({ step, hasRunFailed }: { step: RunStep; hasRunFailed: boolean }) {
  if (step.isDone) {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok-strong">
        <StrokeIcon size={11} strokeWidth={3}>
          <path d="M5 12.5 10 17 19 7" />
        </StrokeIcon>
      </span>
    )
  }
  return (
    <span
      className={joinClassNames(
        'flex size-[18px] shrink-0 items-center justify-center rounded-full',
        hasRunFailed ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-strong',
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
    </span>
  )
}

/** Builds a one-run CSV as a data URI so "Export CSV" downloads without a backend. */
function buildRunCsvHref(run: RunRecord): string {
  const csvLines = ['step,detail,status', ...run.steps.map((step) => `"${step.label}","${step.detail}",${step.isDone ? 'done' : 'pending'}`)]
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csvLines.join('\n'))}`
}

/**
 * Side panel on the Runs screen showing one run step by step, its output,
 * and actions to run it again, export it, or read the raw runner log.
 */
export function RunDetailPanel({ run, onClose }: RunDetailPanelProps) {
  const [isRawLogVisible, setIsRawLogVisible] = useState(false)
  const hasRunFailed = run.status === 'failed'

  return (
    <aside aria-labelledby="run-h" className="box-border flex min-w-0 flex-[2_1_360px] flex-col gap-[18px] border-l border-line bg-subtle p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="run-h" className="m-0 text-[17px] font-semibold">
            {run.agentName}
          </h2>
          <span className="text-body">{run.timing}</span>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="size-8 cursor-pointer rounded-lg border-0 bg-transparent text-[18px] text-ink-2 hover:bg-chip">
          ×
        </button>
      </div>

      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {run.steps.map((step, stepIndex) => (
          <li key={`${stepIndex}-${step.label}`} className="flex items-center gap-2.5 py-2">
            <StepIndicator step={step} hasRunFailed={hasRunFailed} />
            <span className="flex-auto">{step.label}</span>
            <span className="text-[12px] text-muted">{step.detail}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3.5">
        <span className="text-[12px] font-medium text-muted">Output</span>
        <span>{run.output}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {run.followUp && (
          <Link to={run.followUp.path} className="inline-flex h-9 items-center rounded-[9px] bg-ink px-3.5 text-[13px] font-semibold no-underline !text-white hover:bg-ink-2">
            {run.followUp.label}
          </Link>
        )}
        <Link to={run.agentId ? agentPath('testRun', run.agentId) : routePaths.runs} className={outlineActionClassNames}>
          Run again
        </Link>
        <a href={buildRunCsvHref(run)} download={`${run.id}.csv`} className={outlineActionClassNames}>
          Export CSV
        </a>
        <button
          type="button"
          aria-expanded={isRawLogVisible}
          onClick={() => setIsRawLogVisible((isVisible) => !isVisible)}
          className="h-9 cursor-pointer rounded-[9px] border-0 bg-transparent px-3.5 text-[13px] font-medium text-brand-strong hover:bg-chip"
        >
          {isRawLogVisible ? 'Hide raw log' : 'Show raw log'}
        </button>
      </div>

      {isRawLogVisible && (
        <pre aria-label="Raw log" className="m-0 overflow-x-auto rounded-xl border border-line bg-surface p-3.5 font-mono text-[12px] leading-relaxed text-ink-2">
          {run.rawLog.join('\n')}
        </pre>
      )}
    </aside>
  )
}
