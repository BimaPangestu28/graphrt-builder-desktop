import { Link } from 'react-router-dom'
import { humanizeRunError } from './runErrorText'
import type { RunStepView } from './runSteps'
import { readFinalText, summarizeValues } from './stepValueSummary'

/**
 * What an expanded step row shows: streamed / final text of a model step, the step's inputs and
 * outputs summarized, its error in plain words (raw text under "Technical details"), retries
 * and token usage.
 */

const sectionLabelClassNames = 'text-[12px] font-medium text-muted'
const valueBoxClassNames = 'm-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-2'

function ValueList({ title, values, skippedKeys }: { title: string; values: unknown; skippedKeys?: string[] }) {
  const entries = summarizeValues(values, skippedKeys)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className={sectionLabelClassNames}>{title}</span>
      <dl className="m-0 flex flex-col gap-1.5">
        {entries.map((entry) => (
          <div key={entry.key} className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-body">{entry.key}</dt>
            <dd className="m-0">
              <pre className={valueBoxClassNames}>{entry.text}</pre>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ModelText({ step }: { step: RunStepView }) {
  const finalText = readFinalText(step.outputs)
  const isStreaming = step.state === 'running'
  const text = isStreaming ? step.streamedText : (finalText ?? step.streamedText)
  if (!text && !isStreaming) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className={sectionLabelClassNames}>{isStreaming ? 'Writing…' : 'Text'}</span>
      <p aria-label={isStreaming ? 'Streaming text' : 'Final text'} className="m-0 whitespace-pre-wrap break-words rounded-lg bg-brand-tint px-3 py-2 leading-[1.6]">
        {text || 'Waiting for the first words…'}
      </p>
    </div>
  )
}

/** The error in plain words, the raw text one click away. */
export function ErrorExplanation({ rawError, stepDetail, fixPath }: { rawError: string; stepDetail: string | null; fixPath?: string | null }) {
  const { summary } = humanizeRunError(rawError, stepDetail)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-danger-line bg-danger-tint px-3 py-2">
      <span className="font-medium text-danger">{summary}</span>
      <details className="text-[12px] text-body">
        <summary className="cursor-pointer">Technical details</summary>
        <pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono">{rawError}</pre>
      </details>
      {fixPath && (
        <Link to={fixPath} className="text-[13px] font-medium">
          Ask the builder to fix this step
        </Link>
      )}
    </div>
  )
}

function formatUsage(step: RunStepView): string | null {
  if (!step.usage) return null
  const { totalTokens, promptTokens, completionTokens } = step.usage
  return `${totalTokens} tokens (${promptTokens} in · ${completionTokens} out)`
}

function describeEmptyState(step: RunStepView): string | null {
  if (step.state === 'pending') return step.itemDescription ? 'Not started for this item yet' : 'Not started yet'
  if (step.state === 'skipped') return 'Skipped: nothing led to this step this time'
  if (step.state === 'waiting') return 'Waiting for your answer'
  return null
}

interface StepDetailsProps {
  step: RunStepView
  id: string
  /** Where "Ask the builder to fix this step" goes, for failed steps. */
  fixPath?: string | null
}

export function StepDetails({ step, id, fixPath }: StepDetailsProps) {
  const usageText = formatUsage(step)
  const emptyState = describeEmptyState(step)
  const hasValues = step.outputs !== null || step.inputs !== undefined
  return (
    <div id={id} className="flex flex-col gap-3 pb-1 pt-2 motion-safe:animate-[step-details-in_160ms_ease-out]">
      {step.itemDescription && <span className="text-[13px] text-body">{step.itemDescription}</span>}
      {step.iteration?.currentNumber && (
        <span className="text-[13px] text-body">
          {step.iteration.doneCount} {step.iteration.isLoop ? 'rounds' : 'items'} done
          {step.iteration.total !== null && ` of ${step.iteration.total}`}
        </span>
      )}
      {step.isModelStep && <ModelText step={step} />}
      {step.errorMessage && step.iteration === null && <ErrorExplanation rawError={step.errorMessage} stepDetail={step.stepDetail} fixPath={fixPath} />}
      {step.retryCount > 0 && (
        <span className="text-[13px] text-body">
          Retried {step.retryCount === 1 ? 'once' : `${step.retryCount} times`}
          {step.lastRetryError && `: ${humanizeRunError(step.lastRetryError, step.stepDetail).summary}`}
        </span>
      )}
      <ValueList title="Inputs" values={step.inputs} />
      <ValueList title="Outputs" values={step.outputs} skippedKeys={step.isModelStep ? ['text'] : []} />
      {usageText && <span className="text-[12px] text-muted">{usageText}</span>}
      {emptyState && !hasValues &&<span className="text-[13px] text-muted">{emptyState}</span>}
    </div>
  )
}
