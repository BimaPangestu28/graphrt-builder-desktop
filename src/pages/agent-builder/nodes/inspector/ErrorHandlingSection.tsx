import type { JsonValue, OnErrorStrategy, RetrySettings } from '@/api/agentGraphTypes'
import { readConfigText } from './configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, TextInput } from './fields'
import { useInspector } from './InspectorContext'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/**
 * "When this step fails" (spec B3), on every step: Try again (`retry.max_retries`,
 * `interval_ms`, `backoff`), the time limit for each try (`timeout_ms`), and what
 * happens then (`on_error.strategy`): Stop the run, Go to the error path (adds the
 * `fail-branch` port), or Continue with fallback values (`on_error.values`).
 */

/** "Waits 2 s, then 4 s." for the retry settings, or null without retries. */
export function describeRetryWaits(retry: RetrySettings): string | null {
  if (retry.maxRetries <= 0) return null
  const waits = Array.from({ length: Math.min(retry.maxRetries, 4) }, (_unused, attempt) => (retry.intervalMs / 1000) * retry.backoff ** attempt)
  const words = waits.map((seconds) => `${Number(seconds.toFixed(1))} s`)
  const listed = words.length === 1 ? words[0] : messages().nodes.valueThenValue2(words.slice(0, -1).join(', '), words[words.length - 1])
  return messages().nodes.waitsListedValue(listed, retry.maxRetries > 4 ? ', …' : '')
}

/** A fallback value typed as text: JSON when it parses (numbers, true, null, objects), else the text. */
export function parseFallbackValue(text: string): JsonValue {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    return text
  }
}

function formatFallbackValue(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const strategyNames: Readonly<Record<OnErrorStrategy, string>> = localizedRecord(() => messages().nodes.strategies)

function FallbackValues() {
  const { node, kindInfo, updateNode, readOnly } = useInspector()
  const values = node.onError.values
  const setValues = (nextValues: Record<string, JsonValue>, what: string) => updateNode({ onError: { ...node.onError, values: nextValues } }, what)
  const unusedOutput = (kindInfo?.outputs ?? []).map((output) => output.name).find((name) => !(name in values))
  return (
    <div aria-label={messages().nodes.fallbackValues} role="group" className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-line-heavy px-2.5 py-2">
      <span className="text-[12px] font-medium text-ink-2">{messages().nodes.fallbackValues}</span>
      {Object.entries(values).map(([name, value]) => (
        <div key={name} className="grid grid-cols-[110px_minmax(0,1fr)_24px] items-center gap-1.5 text-[12px]">
          <span className="truncate font-mono">{name}</span>
          <TextInput
            ariaLabel={messages().nodes.fallbackForName(name)}
            value={formatFallbackValue(value)}
            monospace
            disabled={readOnly}
            onCommit={(text) => setValues({ ...values, [name]: parseFallbackValue(text) }, messages().nodes.setFallbackName(name))}
          />
          <RemoveButton
            label={messages().nodes.removeName(name)}
            disabled={readOnly}
            onClick={() => {
              const { [name]: _removed, ...rest } = values
              setValues(rest, messages().nodes.removedFallbackName(name))
            }}
          />
        </div>
      ))}
      <AddFallbackValue suggestedName={unusedOutput ?? ''} onAdd={(name) => setValues({ ...values, [name]: null }, messages().nodes.addedFallbackName(name))} disabled={readOnly} takenNames={Object.keys(values)} />
    </div>
  )
}

function AddFallbackValue({ suggestedName, onAdd, disabled, takenNames }: { suggestedName: string; onAdd: (name: string) => void; disabled: boolean; takenNames: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <TextInput
        ariaLabel={messages().nodes.newFallbackValueName}
        placeholder={suggestedName || messages().nodes.outputName}
        value=""
        disabled={disabled}
        monospace
        onCommit={(name) => {
          const trimmed = name.trim()
          if (trimmed && !takenNames.includes(trimmed)) onAdd(trimmed)
        }}
      />
      <AddButton disabled={disabled || !suggestedName} onClick={() => onAdd(suggestedName)}>
        {messages().nodes.addAValue}
      </AddButton>
    </div>
  )
}

export function ErrorHandlingSection() {
  const { node, updateNode, readOnly } = useInspector()
  const { retry, onError } = node
  const setRetry = (changes: Partial<RetrySettings>, what: string) => updateNode({ retry: { ...retry, ...changes } }, what)
  const waits = describeRetryWaits(retry)
  const isHttp = node.kind === 'http-request'
  const method = readConfigText(node.config, ['method']).toLowerCase() || 'get'
  const isNonIdempotent = isHttp && (method === 'post' || method === 'patch') && node.config.retry_non_idempotent !== true
  // Approvals set their time limit (`expire_after_ms`) and tools their wait (`timeout_ms`) in their own panel.
  const ownsTimeout = node.kind === 'human-input' || node.kind === 'tool'
  return (
    <InspectorSection title={messages().nodes.whenThisStepFails} sectionKey="on-error" defaultOpen={onError.strategy !== 'fail' || retry.maxRetries > 0}>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-ink-2">{messages().nodes.tryAgain}</span>
        <div className="flex flex-wrap items-center gap-2">
          <NumberInput ariaLabel={messages().nodes.retries} value={retry.maxRetries} min={0} max={10} disabled={readOnly} suffix="times" onCommit={(value) => setRetry({ maxRetries: value ?? 0 }, messages().nodes.setRetryValue(value ?? 0))} />
          <NumberInput
            ariaLabel={messages().nodes.waitBeforeTheFirstRetry}
            value={retry.intervalMs / 1000}
            min={0}
            max={3600}
            step={0.5}
            disabled={readOnly}
            suffix="s"
            onCommit={(value) => setRetry({ intervalMs: Math.round((value ?? 0) * 1000) }, messages().nodes.setTheRetryWait)}
          />
          <NumberInput ariaLabel={messages().nodes.multiplyTheWaitBy} value={retry.backoff} min={1} max={10} step={0.5} disabled={readOnly} suffix={messages().nodes.eachTime} onCommit={(value) => setRetry({ backoff: Math.max(1, value ?? 1) }, messages().nodes.setTheRetryBackoff)} />
        </div>
        <p className={hintClassName}>
          {waits ? `${waits} ` : ''}{messages().nodes.errorsThatCanAposTSucceed}
        </p>
        {isNonIdempotent && retry.maxRetries > 0 && <p className="m-0 text-[12px] text-amber-strong">{messages().nodes.this}{' '}{method.toUpperCase()} {messages().nodes.requestIsNotRetriedUnlessRetry}</p>}
      </div>
      {!ownsTimeout && (
        <Field label={messages().nodes.timeLimitForEachTry}>
          <span className="flex items-center gap-2">
            <NumberInput
              ariaLabel={messages().nodes.timeLimit}
              value={node.timeoutMs === null ? null : node.timeoutMs / 1000}
              min={1}
              max={86400}
              disabled={readOnly}
              suffix="s"
              onCommit={(value) => updateNode({ timeoutMs: value === null ? null : Math.round(value * 1000) }, value === null ? messages().nodes.clearedTheTimeLimit : messages().nodes.setTheTimeLimitToValue(value))}
            />
            <span className={hintClassName}>{messages().nodes.emptyUsesTheAppDefault2}</span>
          </span>
        </Field>
      )}
      <RadioCards
        legend={messages().nodes.thenIfItStillFails}
        name="on-error"
        value={onError.strategy}
        disabled={readOnly}
        onChange={(strategy) => updateNode({ onError: { ...onError, strategy: strategy as OnErrorStrategy } }, messages().nodes.setValue(strategyNames[strategy as OnErrorStrategy]))}
        options={[
          { value: 'fail', title: strategyNames.fail, description: messages().nodes.defaultInsideALoopTheLoops },
          { value: 'fail-branch', title: strategyNames['fail-branch'], description: messages().nodes.addsAnOnErrorPortSteps },
          { value: 'default-value', title: strategyNames['default-value'], description: messages().nodes.carriesOnAsIfItWorked },
        ]}
      />
      {onError.strategy === 'default-value' && <FallbackValues />}
      {(onError.strategy !== 'fail' || retry.maxRetries > 0) && ['llm', 'agent', 'answer'].includes(node.kind) && (
        <p className={hintClassName}>{messages().nodes.stepsWithRetriesOrWhenThis}</p>
      )}
    </InspectorSection>
  )
}
