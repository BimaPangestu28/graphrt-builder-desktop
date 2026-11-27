import { Link } from 'react-router-dom'
import { ErrorHelpNotice } from '@/components/errors/ErrorHelpNotice'
import { pluginNameFromNodeType } from '@/lib/errorHelp'
import { buildFixStepPath } from './fixStepRequest'
import { humanizeRunError } from './runErrorText'
import type { RunStepView } from './runSteps'
import { readFinalText, summarizeValues } from './stepValueSummary'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import { agentPath, routePaths } from '@/routes'
import { messages } from '@/i18n'

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
      <span className={sectionLabelClassNames}>{isStreaming ? messages().agentRun.writing : messages().agentRun.text}</span>
      <p aria-label={isStreaming ? messages().agentRun.streamingText : messages().agentRun.finalText} className="m-0 whitespace-pre-wrap break-words rounded-lg bg-brand-tint px-3 py-2 leading-[1.6]">
        {text || messages().agentRun.waitingForTheFirstWords}
      </p>
    </div>
  )
}

interface ErrorExplanationProps {
  rawError: string
  stepDetail: string | null
  fixStepPath?: string | null
  /** The failure's error kind; a known one adds what to do next and keeps the message in view. */
  errorType?: string | null
  /** The step's node type, to name the plugin the error came from. */
  nodeType?: string | null
}

/**
 * The error in plain words. With a known error kind: what to do next, a button to the fix and
 * the original message in view; otherwise the raw text one click away.
 */
export function ErrorExplanation({ rawError, stepDetail, fixStepPath, errorType = null, nodeType = null }: ErrorExplanationProps) {
  const { summary, help } = humanizeRunError(rawError, stepDetail, errorType)
  const fixLink = fixStepPath && (
    <Link to={fixStepPath} className="text-[13px] font-medium">
      {messages().agentRun.askTheBuilderToFixThis}
    </Link>
  )
  if (help) {
    return (
      <ErrorHelpNotice help={help} headline={summary} detail={rawError} pluginName={pluginNameFromNodeType(nodeType)}>
        {fixLink}
      </ErrorHelpNotice>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-danger-line bg-danger-tint px-3 py-2">
      <span className="font-medium text-danger">{summary}</span>
      <details className="text-[12px] text-body">
        <summary className="cursor-pointer">{messages().agentRun.technicalDetails}</summary>
        <pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono">{rawError}</pre>
      </details>
      {fixLink}
    </div>
  )
}

function formatUsage(step: RunStepView): string | null {
  if (!step.usage) return null
  const { totalTokens, promptTokens, completionTokens } = step.usage
  return messages().agentRun.tokensLine(totalTokens, promptTokens, completionTokens)
}

function describeEmptyState(step: RunStepView): string | null {
  if (step.state === 'pending') return step.itemDescription ? messages().agentRun.notStartedForThisItemYet : messages().agentRun.notStartedYet
  if (step.state === 'skipped') return messages().agentRun.skippedNothingLedToThisStep
  if (step.state === 'waiting') return messages().agentRun.waitingForYourAnswer
  return null
}

/** "Send message of WhatsApp API" from `whatsapp-api/send_message`; the whole plugin for `plugin/*`. */
function describeUnavailableTool(tool: string): string {
  const [provider, action] = tool.split('/')
  const providerLabel = humanizePluginName(provider ?? tool)
  if (!action || action === '*') return providerLabel
  const actionLabel = action.replace(/[_.-]+/g, ' ').trim()
  return messages().agentRun.toolOfPlugin(actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1), providerLabel)
}

/**
 * What the step used from Skills and from what the agent learned: how many learned notes it
 * read (with a link to them when the agent is known), and tools a skill was allowed but could
 * not use because nothing on this computer provides them.
 */
function SkillAndLearningNotes({ step, agentId }: { step: RunStepView; agentId?: string | null }) {
  const t = messages().agentRun
  if (step.learnedNoteCount === 0 && step.unavailableSkillTools.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {step.learnedNoteCount > 0 && (
        <span className="text-[13px] text-body">
          {t.usedLearnedNotes(step.learnedNoteCount)}
          {agentId && (
            <>
              {' '}
              <Link to={agentPath('learned', agentId, { tab: 'inUse' })} className="font-medium">
                {t.seeLearnedNotes}
              </Link>
            </>
          )}
        </span>
      )}
      {step.unavailableSkillTools.length > 0 && (
        <div role="note" className="flex flex-col gap-1 rounded-lg border border-amber-line-2 bg-amber-tint px-3 py-2 text-[13px] text-ink">
          <span className="font-medium">{t.skillToolsMissing}</span>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
            {step.unavailableSkillTools.map((missing) => (
              <li key={`${missing.skill}/${missing.tool}`}>{t.skillToolMissing(humanizePluginName(missing.skill), describeUnavailableTool(missing.tool))}</li>
            ))}
          </ul>
          <span className="text-[12px] text-body">
            {t.skillToolsMissingHint}{' '}
            <Link to={routePaths.plugins} className="font-medium">
              {t.openPlugins}
            </Link>
          </span>
        </div>
      )}
    </div>
  )
}

interface StepDetailsProps {
  step: RunStepView
  id: string
  /** Agent whose builder "Ask the builder to fix this step" opens, for failed steps. */
  fixAgentId?: string | null
  /** The run's agent, to link to what it learned. */
  agentId?: string | null
}

export function StepDetails({ step, id, fixAgentId, agentId }: StepDetailsProps) {
  const usageText = formatUsage(step)
  const emptyState = describeEmptyState(step)
  const hasValues = step.outputs !== null || step.inputs !== undefined || step.learnedNoteCount > 0 || step.unavailableSkillTools.length > 0
  return (
    <div id={id} className="flex flex-col gap-3 pb-1 pt-2 motion-safe:animate-[step-details-in_160ms_ease-out]">
      {step.itemDescription && <span className="text-[13px] text-body">{step.itemDescription}</span>}
      {step.iteration?.currentNumber && (
        <span className="text-[13px] text-body">
          {step.iteration.doneCount} {step.iteration.isLoop ? 'rounds' : 'items'} {messages().agentRun.done}
          {step.iteration.total !== null && messages().agentRun.ofTotal(step.iteration.total)}
        </span>
      )}
      <SkillAndLearningNotes step={step} agentId={agentId} />
      {step.isModelStep && <ModelText step={step} />}
      {step.errorMessage && step.iteration === null && <ErrorExplanation rawError={step.errorMessage} stepDetail={step.stepDetail} errorType={step.errorType} nodeType={step.nodeType} fixStepPath={fixAgentId ? buildFixStepPath(fixAgentId, step) : null} />}
      {step.retryCount > 0 && (
        <span className="text-[13px] text-body">
          {messages().agentRun.retried}{' '}{step.retryCount === 1 ? messages().agentRun.retriedOnce : messages().agentRun.retriedTimes(step.retryCount)}
          {step.lastRetryError && `: ${humanizeRunError(step.lastRetryError, step.stepDetail).summary}`}
        </span>
      )}
      <ValueList title={messages().agentRun.inputs} values={step.inputs} />
      {step.chosenAction && (
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabelClassNames}>{messages().agentRun.chosenButton}</span>
          <span className="font-medium text-ink">{step.chosenAction}</span>
        </div>
      )}
      <ValueList title={messages().agentRun.outputs} values={step.outputs} skippedKeys={[...(step.isModelStep ? ['text'] : []), ...(step.chosenAction ? ['action'] : [])]} />
      {usageText && <span className="text-[12px] text-muted">{usageText}</span>}
      {emptyState && !hasValues &&<span className="text-[13px] text-muted">{emptyState}</span>}
    </div>
  )
}
