import type { JsonValue, OnErrorStrategy, RetrySettings } from '@/api/agentGraphTypes'
import { readConfigText } from './configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, TextInput } from './fields'
import { useInspector } from './InspectorContext'

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
  const listed = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')}, then ${words[words.length - 1]}`
  return `Waits ${listed}${retry.maxRetries > 4 ? ', …' : ''}.`
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

const strategyNames: Record<OnErrorStrategy, string> = { fail: 'Stop the run', 'fail-branch': 'Go to the error path', 'default-value': 'Continue with fallback values' }

function FallbackValues() {
  const { node, kindInfo, updateNode, readOnly } = useInspector()
  const values = node.onError.values
  const setValues = (nextValues: Record<string, JsonValue>, what: string) => updateNode({ onError: { ...node.onError, values: nextValues } }, what)
  const unusedOutput = (kindInfo?.outputs ?? []).map((output) => output.name).find((name) => !(name in values))
  return (
    <div aria-label="Fallback values" role="group" className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-line-heavy px-2.5 py-2">
      <span className="text-[12px] font-medium text-ink-2">Fallback values</span>
      {Object.entries(values).map(([name, value]) => (
        <div key={name} className="grid grid-cols-[110px_minmax(0,1fr)_24px] items-center gap-1.5 text-[12px]">
          <span className="truncate font-mono">{name}</span>
          <TextInput
            ariaLabel={`Fallback for ${name}`}
            value={formatFallbackValue(value)}
            monospace
            disabled={readOnly}
            onCommit={(text) => setValues({ ...values, [name]: parseFallbackValue(text) }, `set fallback ${name}`)}
          />
          <RemoveButton
            label={`Remove ${name}`}
            disabled={readOnly}
            onClick={() => {
              const { [name]: _removed, ...rest } = values
              setValues(rest, `removed fallback ${name}`)
            }}
          />
        </div>
      ))}
      <AddFallbackValue suggestedName={unusedOutput ?? ''} onAdd={(name) => setValues({ ...values, [name]: null }, `added fallback ${name}`)} disabled={readOnly} takenNames={Object.keys(values)} />
    </div>
  )
}

function AddFallbackValue({ suggestedName, onAdd, disabled, takenNames }: { suggestedName: string; onAdd: (name: string) => void; disabled: boolean; takenNames: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <TextInput
        ariaLabel="New fallback value name"
        placeholder={suggestedName || 'output name'}
        value=""
        disabled={disabled}
        monospace
        onCommit={(name) => {
          const trimmed = name.trim()
          if (trimmed && !takenNames.includes(trimmed)) onAdd(trimmed)
        }}
      />
      <AddButton disabled={disabled || !suggestedName} onClick={() => onAdd(suggestedName)}>
        Add a value
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
  // Approvals and tools set `timeout_ms` in their own panel (expiry, tool wait).
  const ownsTimeout = node.kind === 'human-input' || node.kind === 'tool'
  return (
    <InspectorSection title="When this step fails" defaultOpen={onError.strategy !== 'fail' || retry.maxRetries > 0}>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-ink-2">Try again</span>
        <div className="flex flex-wrap items-center gap-2">
          <NumberInput ariaLabel="Retries" value={retry.maxRetries} min={0} max={10} disabled={readOnly} suffix="times" onCommit={(value) => setRetry({ maxRetries: value ?? 0 }, `set Retry ${value ?? 0}×`)} />
          <NumberInput
            ariaLabel="Wait before the first retry"
            value={retry.intervalMs / 1000}
            min={0}
            max={3600}
            step={0.5}
            disabled={readOnly}
            suffix="s"
            onCommit={(value) => setRetry({ intervalMs: Math.round((value ?? 0) * 1000) }, 'set the retry wait')}
          />
          <NumberInput ariaLabel="Multiply the wait by" value={retry.backoff} min={1} max={10} step={0.5} disabled={readOnly} suffix="× each time" onCommit={(value) => setRetry({ backoff: Math.max(1, value ?? 1) }, 'set the retry backoff')} />
        </div>
        <p className={hintClassName}>
          {waits ? `${waits} ` : ''}Errors that can&apos;t succeed on a retry (like a wrong number) are not retried. When the service says when to try again, graphrt waits that long, up to 5 minutes
        </p>
        {isNonIdempotent && retry.maxRetries > 0 && <p className="m-0 text-[12px] text-amber-strong">This {method.toUpperCase()} request is not retried unless “Retry POST and PATCH too” is on (Advanced).</p>}
      </div>
      {!ownsTimeout && (
        <Field label="Time limit for each try">
          <span className="flex items-center gap-2">
            <NumberInput
              ariaLabel="Time limit"
              value={node.timeoutMs === null ? null : node.timeoutMs / 1000}
              min={1}
              max={86400}
              disabled={readOnly}
              suffix="s"
              onCommit={(value) => updateNode({ timeoutMs: value === null ? null : Math.round(value * 1000) }, value === null ? 'cleared the time limit' : `set the time limit to ${value} s`)}
            />
            <span className={hintClassName}>Empty uses the app default, 2 minutes</span>
          </span>
        </Field>
      )}
      <RadioCards
        legend="Then, if it still fails"
        name="on-error"
        value={onError.strategy}
        disabled={readOnly}
        onChange={(strategy) => updateNode({ onError: { ...onError, strategy: strategy as OnErrorStrategy } }, `set “${strategyNames[strategy as OnErrorStrategy]}”`)}
        options={[
          { value: 'fail', title: strategyNames.fail, description: 'Default. Inside a loop, the loop’s “If one item fails” setting decides what happens' },
          { value: 'fail-branch', title: strategyNames['fail-branch'], description: 'Adds an “On error” port. Steps there can use error_message and error_type' },
          { value: 'default-value', title: strategyNames['default-value'], description: 'Carries on as if it worked, with the values below plus error_message and error_type' },
        ]}
      />
      {onError.strategy === 'default-value' && <FallbackValues />}
      {(onError.strategy !== 'fail' || retry.maxRetries > 0) && ['llm', 'agent', 'answer'].includes(node.kind) && (
        <p className={hintClassName}>Steps with retries or “When this step fails” set don’t stream their answer live; it appears when the step ends.</p>
      )}
    </InspectorSection>
  )
}
