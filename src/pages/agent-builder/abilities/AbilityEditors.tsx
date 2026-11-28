import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { abilityBounds } from '@/api/abilitiesTypes'
import type { AbilityChange, AgentAbilities, ContextMode, SpendingLimit } from '@/api/abilitiesTypes'
import { Button } from '@/components/ui'
import { useT } from '@/i18n'
import { agentPath } from '@/routes'
import { AbilityChoiceCard, abilityChoiceGridClassNames } from './AbilityChoiceCard'
import { formatTokens, microsToFieldText, parseTokenCount, readSpendingDraft } from './abilitiesDisplay'

/** Saving an editor: every editor hands over its changes and the section saves them in order. */
export type SaveAbilities = (changes: AbilityChange[] | { spending: SpendingLimit }) => Promise<boolean>

interface EditorFrameProps {
  title: string
  /** `[current, total]` for a wizard with several steps. */
  step?: [number, number]
  error: string | null
  isSaving: boolean
  onCancel: () => void
  /** The main button: Save on the last step, Next before it. */
  primaryLabel: string
  onPrimary: () => void
  onBack?: () => void
  children: ReactNode
}

/** The frame of one ability editor: a wide card with its title, the choices, and the buttons. */
function EditorFrame({ title, step, error, isSaving, onCancel, primaryLabel, onPrimary, onBack, children }: EditorFrameProps) {
  const t = useT().abilities.section
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stepNumber = step?.[0] ?? 0
  // Keyboard and screen reader users land on the editor, and on each new step of a wizard.
  useEffect(() => headingRef.current?.focus(), [stepNumber])
  return (
    <section aria-labelledby={headingId} className="@container flex min-w-0 flex-col gap-4 rounded-[14px] border border-line-strong bg-surface p-4">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 id={headingId} ref={headingRef} tabIndex={-1} className="m-0 truncate text-[15px] font-semibold text-ink outline-none">
          {title}
        </h4>
        {step && (
          <span aria-live="polite" className="shrink-0 text-[12px] text-muted">
            {t.stepOf(step[0], step[1])}
          </span>
        )}
      </header>
      {children}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {t.cancel}
        </Button>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack} disabled={isSaving}>
            {t.back}
          </Button>
        )}
        <Button size="sm" onClick={onPrimary} disabled={isSaving}>
          {isSaving ? t.saving : primaryLabel}
        </Button>
      </div>
    </section>
  )
}

/** "Advanced": options most people never need, folded away. */
function Advanced({ children }: { children: ReactNode }) {
  const t = useT().abilities.section
  return (
    <details className="group min-w-0 rounded-[10px] border border-line bg-subtle px-3 py-2">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink-2">{t.advanced}</summary>
      <div className="flex min-w-0 flex-col gap-3 pt-3">{children}</div>
    </details>
  )
}

interface NumberFieldProps {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  inputMode?: 'numeric' | 'decimal'
  placeholder?: string
}

function TextNumberField({ label, hint, value, onChange, inputMode = 'numeric', placeholder }: NumberFieldProps) {
  const inputId = useId()
  const hintId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="box-border h-9 w-full max-w-[240px] rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink"
      />
      {hint && (
        <span id={hintId} className="text-[12px] leading-[17px] text-muted">
          {hint}
        </span>
      )}
    </div>
  )
}

interface EditorProps {
  abilities: AgentAbilities
  isSaving: boolean
  error: string | null
  onCancel: () => void
  onSave: SaveAbilities
}

const contextModes: readonly ContextMode[] = ['auto', 'summarize', 'off']

export function ContextEditor({ abilities, isSaving, error, onCancel, onSave }: EditorProps) {
  const t = useT().abilities.context
  const section = useT().abilities.section
  const [mode, setMode] = useState<ContextMode>(abilities.context.mode)
  const [maxTokensText, setMaxTokensText] = useState(abilities.context.maxTokens === null ? '' : String(abilities.context.maxTokens))
  const [localError, setLocalError] = useState<string | null>(null)
  const groupName = useId()

  function save() {
    const parsed = parseTokenCount(maxTokensText, abilityBounds.minContextTokens, abilityBounds.maxContextTokens)
    if (parsed.kind === 'invalid') return setLocalError(section.outOfRange(t.maxTokensLabel, formatTokens(abilityBounds.minContextTokens), formatTokens(abilityBounds.maxContextTokens)))
    const maxTokens = parsed.kind === 'value' && mode !== 'off' ? parsed.value : null
    setLocalError(null)
    void onSave([{ kind: 'context', mode, maxTokens }])
  }

  return (
    <EditorFrame title={t.title} error={localError ?? error} isSaving={isSaving} onCancel={onCancel} primaryLabel={useT().abilities.section.save} onPrimary={save}>
      <fieldset className={abilityChoiceGridClassNames(contextModes.length)}>
        <legend className="mb-2 text-[13px] text-body">{t.question}</legend>
        {contextModes.map((choice) => (
          <AbilityChoiceCard key={choice} type="radio" name={groupName} checked={mode === choice} onChange={() => setMode(choice)} title={t.choices[choice].title} details={t.choices[choice].details} />
        ))}
      </fieldset>
      <Advanced>
        <TextNumberField label={t.maxTokensLabel} hint={mode === 'off' ? t.maxTokensOffNote : t.maxTokensHint} value={maxTokensText} onChange={setMaxTokensText} placeholder="60000" />
      </Advanced>
    </EditorFrame>
  )
}

export function MemoryEditor({ abilities, isSaving, error, onCancel, onSave }: EditorProps) {
  const t = useT().abilities.memory
  const [enabled, setEnabled] = useState(abilities.memory.enabled)
  const [graph, setGraph] = useState(abilities.memory.graph)
  const groupName = useId()
  const graphHintId = useId()
  const graphLabelId = useId()
  return (
    <EditorFrame title={t.title} error={error} isSaving={isSaving} onCancel={onCancel} primaryLabel={useT().abilities.section.save} onPrimary={() => void onSave([{ kind: 'memory', enabled, graph: enabled && graph }])}>
      <fieldset className={abilityChoiceGridClassNames(2)}>
        <legend className="mb-2 text-[13px] text-body">{t.question}</legend>
        <AbilityChoiceCard type="radio" name={groupName} checked={enabled} onChange={() => setEnabled(true)} title={t.on.title} details={t.on.details} />
        <AbilityChoiceCard type="radio" name={groupName} checked={!enabled} onChange={() => setEnabled(false)} title={t.off.title} details={t.off.details} />
      </fieldset>
      {enabled && <p className="m-0 text-[12.5px] leading-[18px] text-muted">{t.safety}</p>}
      <Advanced>
        <label className="flex min-w-0 cursor-pointer items-start gap-2.5 text-[13px] text-ink">
          <input type="checkbox" checked={enabled && graph} disabled={!enabled} onChange={(event) => setGraph(event.target.checked)} aria-labelledby={graphLabelId} aria-describedby={graphHintId} className="mt-[2px] size-4 shrink-0 accent-ink" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id={graphLabelId} className="font-medium">
              {t.graphLabel}
            </span>
            <span id={graphHintId} className="text-[12px] leading-[17px] text-muted">
              {t.graphHint}
            </span>
          </span>
        </label>
      </Advanced>
      <Link to={agentPath('learned', abilities.agentId, { tab: 'memory' })} className="self-start text-[13px] font-medium">
        {t.seeMemory}
      </Link>
    </EditorFrame>
  )
}

/** Two steps: which agents it may ask, then how much and what is safe to repeat. */
export function HelpersEditor({ abilities, isSaving, error, onCancel, onSave }: EditorProps) {
  const all = useT().abilities
  const t = all.helpers
  const [step, setStep] = useState<1 | 2>(1)
  const [agentIds, setAgentIds] = useState<string[]>(abilities.helpers.agentIds)
  const [maxParallelText, setMaxParallelText] = useState(String(abilities.helpers.maxParallel))
  const [maxCallsText, setMaxCallsText] = useState(String(abilities.helpers.maxCalls))
  const [retrySafeTools, setRetrySafeTools] = useState<string[]>(abilities.retrySafeTools)
  const [localError, setLocalError] = useState<string | null>(null)

  function toggle(agentId: string, isChecked: boolean) {
    setAgentIds((current) => (isChecked ? [...current, agentId] : current.filter((id) => id !== agentId)))
  }

  function save() {
    const maxParallel = parseTokenCount(maxParallelText, 1, abilityBounds.maxParallel)
    const maxCalls = parseTokenCount(maxCallsText, 1, abilityBounds.maxCalls)
    if (maxParallel.kind !== 'value') return setLocalError(all.section.outOfRange(t.maxParallelLabel, '1', String(abilityBounds.maxParallel)))
    if (maxCalls.kind !== 'value') return setLocalError(all.section.outOfRange(t.maxCallsLabel, '1', String(abilityBounds.maxCalls)))
    setLocalError(null)
    const changes: AbilityChange[] = [{ kind: 'helpers', agentIds, maxParallel: maxParallel.value, maxCalls: maxCalls.value }]
    const retryChanged = retrySafeTools.length !== abilities.retrySafeTools.length || retrySafeTools.some((tool) => !abilities.retrySafeTools.includes(tool))
    if (retryChanged && abilities.agentSteps > 0) changes.push({ kind: 'retry_safe_tools', tools: retrySafeTools })
    void onSave(changes)
  }

  const isPicking = step === 1
  return (
    <EditorFrame
      title={t.title}
      step={[step, 2]}
      error={localError ?? error}
      isSaving={isSaving}
      onCancel={onCancel}
      primaryLabel={isPicking ? all.section.next : all.section.save}
      onPrimary={isPicking ? () => setStep(2) : save}
      onBack={isPicking ? undefined : () => setStep(1)}
    >
      {isPicking ? (
        <fieldset className={abilityChoiceGridClassNames(abilities.helperChoices.length)}>
          <legend className="mb-1 text-[13px] text-body">{t.pickQuestion}</legend>
          <p className="col-span-full m-0 mb-1 text-[12.5px] text-muted">{t.pickHint}</p>
          {abilities.helperChoices.length === 0 && <p className="col-span-full m-0 text-[13px] text-muted">{t.noOtherAgents}</p>}
          {abilities.helperChoices.map((choice) => (
            <AbilityChoiceCard
              key={choice.agentId}
              type="checkbox"
              name="helpers"
              checked={agentIds.includes(choice.agentId)}
              disabled={choice.unavailable !== null && !agentIds.includes(choice.agentId)}
              onChange={(isChecked) => toggle(choice.agentId, isChecked)}
              title={choice.name}
              details={choice.unavailable ? t.unavailable[choice.unavailable] : choice.description || '—'}
            />
          ))}
        </fieldset>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <p className="m-0 text-[13px] font-medium text-ink">{t.review(agentIds.length)}</p>
          {agentIds.length > 0 && <p className="m-0 text-[12.5px] leading-[18px] text-muted">{t.sharedBudget}</p>}
          <Advanced>
            {agentIds.length > 0 && (
              <>
                <span className="text-[13px] font-medium text-ink">{t.limitsQuestion}</span>
                <div className="grid min-w-0 grid-cols-1 gap-3 @lg:grid-cols-2">
                  <TextNumberField label={t.maxParallelLabel} value={maxParallelText} onChange={setMaxParallelText} />
                  <TextNumberField label={t.maxCallsLabel} value={maxCallsText} onChange={setMaxCallsText} />
                </div>
              </>
            )}
            <span className="text-[13px] font-medium text-ink">{t.retrySafeLabel}</span>
            <span className="text-[12px] leading-[17px] text-muted">{t.retrySafeHint}</span>
            {abilities.toolChoices.length === 0 ? (
              <span className="text-[12.5px] text-muted">{t.noTools}</span>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-1.5 @lg:grid-cols-2">
                {abilities.toolChoices.map((tool) => (
                  <label key={tool} className="flex min-w-0 cursor-pointer items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={retrySafeTools.includes(tool)}
                      onChange={(event) => setRetrySafeTools((current) => (event.target.checked ? [...current, tool] : current.filter((name) => name !== tool)))}
                      className="size-4 shrink-0 accent-ink"
                    />
                    <span className="truncate font-mono text-[12px]" title={tool}>
                      {tool}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Advanced>
        </div>
      )}
    </EditorFrame>
  )
}

export function SpendingEditor({ abilities, isSaving, error, onCancel, onSave }: EditorProps) {
  const t = useT().abilities.spending
  const current = abilities.spending
  const [isLimited, setIsLimited] = useState(current.maxCostMicros !== null || current.maxTotalTokens !== null)
  const [moneyText, setMoneyText] = useState(microsToFieldText(current.maxCostMicros))
  const [tokensText, setTokensText] = useState(current.maxTotalTokens === null ? '' : String(current.maxTotalTokens))
  const [localError, setLocalError] = useState<string | null>(null)
  const groupName = useId()

  function save() {
    const draft = readSpendingDraft(isLimited, moneyText, tokensText)
    if ('error' in draft) return setLocalError(draft.error)
    setLocalError(null)
    void onSave({ spending: draft.limit })
  }

  return (
    <EditorFrame title={t.title} error={localError ?? error} isSaving={isSaving} onCancel={onCancel} primaryLabel={useT().abilities.section.save} onPrimary={save}>
      <fieldset className={abilityChoiceGridClassNames(2)}>
        <legend className="mb-2 text-[13px] text-body">{t.question}</legend>
        <AbilityChoiceCard type="radio" name={groupName} checked={!isLimited} onChange={() => setIsLimited(false)} title={t.noLimit.title} details={t.noLimit.details} />
        <AbilityChoiceCard type="radio" name={groupName} checked={isLimited} onChange={() => setIsLimited(true)} title={t.withLimit.title} details={t.withLimit.details} />
      </fieldset>
      {isLimited && (
        <>
          <TextNumberField label={t.moneyLabel} hint={t.moneyHint} value={moneyText} onChange={setMoneyText} inputMode="decimal" placeholder="0.50" />
          <Advanced>
            <TextNumberField label={t.tokensLabel} hint={t.tokensHint} value={tokensText} onChange={setTokensText} placeholder="50000" />
          </Advanced>
        </>
      )}
      {isLimited && abilities.unpricedModels.length > 0 && <p className="m-0 text-[12.5px] leading-[18px] text-amber-strong">{t.unpriced(abilities.unpricedModels.join(', '))}</p>}
    </EditorFrame>
  )
}
