import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, joinClassNames } from '@/components/ui'
import { fieldPathAttribute, findFieldControl, firstFocusable, isSectionKeyTarget, revealElement, sectionContentAttribute, useSectionRequest } from './sectionRequest'

/**
 * Form building blocks of the step inspector, styled like the spec's B-boards: small
 * labels, 32px inputs, radio cards, collapsible sections. Text and number inputs keep
 * a local draft and commit on blur or Enter, so one typed value is one undo step.
 */

export const inputClassName =
  'box-border h-8 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink disabled:bg-subtle disabled:text-muted'
export const smallInputClassName = 'box-border h-8 w-14 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink disabled:bg-subtle'
export const labelClassName = 'text-[12px] font-medium text-ink-2'
export const hintClassName = 'm-0 text-[12px] leading-normal text-muted'
export const linkButtonClassName = 'cursor-pointer self-start border-0 bg-transparent p-0 text-[12px] font-medium text-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-50'

/** A collapsible group of settings ("Inputs", "When this step fails"). */
interface InspectorSectionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  badge?: ReactNode
  /** Key a `requestedSection` can name to open this section (`on-error`, `sign-in`). */
  sectionKey?: string
}

/**
 * Opens the section for a matching `requestedSection` (its key, or a field inside it) and
 * reveals the target. A closed section renders its body hidden for one pass to look for
 * the field; a section that does not hold it closes that body again.
 */
function useSectionRequestHandling(sectionKey: string | undefined, isOpen: boolean, open: () => void) {
  const { request, claim } = useSectionRequest()
  const [probedSequence, setProbedSequence] = useState<number | null>(null)
  const [revealTarget, setRevealTarget] = useState<{ fieldPath: string | null } | null>(null)
  const handledSequenceRef = useRef<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (!request || handledSequenceRef.current === request.sequence) return
    if (sectionKey && request.section === sectionKey) {
      handledSequenceRef.current = request.sequence
      if (!claim(request.sequence)) return
      open()
      setRevealTarget({ fieldPath: null })
      return
    }
    if (isSectionKeyTarget(request.section)) {
      // Another section's key (`change-action`): nothing to look for in here.
      handledSequenceRef.current = request.sequence
      return
    }
    if (!isOpen && probedSequence !== request.sequence) {
      setProbedSequence(request.sequence)
      return
    }
    handledSequenceRef.current = request.sequence
    setProbedSequence(null)
    if (findFieldControl(contentRef.current, request.section) && claim(request.sequence)) {
      open()
      setRevealTarget({ fieldPath: request.section })
    }
  }, [request, claim, sectionKey, isOpen, probedSequence, open])

  useEffect(() => {
    if (!revealTarget || !isOpen) return
    const control = revealTarget.fieldPath ? findFieldControl(contentRef.current, revealTarget.fieldPath) : (firstFocusable(contentRef.current) ?? firstFocusable(sectionRef.current))
    revealElement(control)
    setRevealTarget(null)
  }, [revealTarget, isOpen])

  return { isProbing: probedSequence !== null, contentRef, sectionRef }
}

export function InspectorSection({ title, defaultOpen = true, children, badge, sectionKey }: InspectorSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentId = useId()
  const openRef = useRef(() => setIsOpen(true))
  const { isProbing, contentRef, sectionRef } = useSectionRequestHandling(sectionKey, isOpen, openRef.current)
  return (
    <section ref={sectionRef} data-section-key={sectionKey} className="flex scroll-mt-3 flex-col gap-2.5 border-t border-chip pt-3">
      <h3 className="m-0 text-[13px] font-semibold">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-ink"
        >
          <span className="flex items-center gap-2">
            {title}
            {badge}
          </span>
          <span aria-hidden="true" className={joinClassNames('flex text-muted transition-transform', isOpen ? 'rotate-90' : '')}>
            <Icon name="chevronRight" size={14} />
          </span>
        </button>
      </h3>
      {(isOpen || isProbing) && (
        <div id={contentId} ref={contentRef} hidden={!isOpen} {...{ [sectionContentAttribute]: '' }} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </section>
  )
}

/** A labelled field with an optional hint and an inline problem. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  warning,
  children,
  fieldPath,
}: {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: string | null
  warning?: string | null
  children: ReactNode
  /** Config path a `requestedSection` can name to focus this field (`url`, `authorization.config.api_key`). */
  fieldPath?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" {...(fieldPath ? { [fieldPathAttribute]: fieldPath } : {})}>
      <label htmlFor={htmlFor} className={labelClassName}>
        {label}
        {required && (
          <span className="text-danger" aria-label="required">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {error}
        </p>
      )}
      {!error && warning && <p className="m-0 text-[12px] text-amber-strong">{warning}</p>}
      {hint && <p className={hintClassName}>{hint}</p>}
    </div>
  )
}

/** Keeps a local copy of `value` while editing; resets when `value` changes from outside. */
function useDraft<Value>(value: Value): [Value, (next: Value) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return [draft, setDraft]
}

interface TextInputProps {
  id?: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  monospace?: boolean
  invalid?: boolean
}

/** One-line text that commits on blur or Enter. */
export function TextInput({ id, value, onCommit, placeholder, ariaLabel, disabled, className, monospace, invalid }: TextInputProps) {
  const [draft, setDraft] = useDraft(value)
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      id={id}
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
      className={joinClassNames(inputClassName, monospace ? 'font-mono text-[12px]' : '', invalid ? 'border-danger' : '', className)}
    />
  )
}

/** Multi-line text that commits on blur. */
export function TextArea({ id, value, onCommit, placeholder, ariaLabel, disabled, rows = 4, monospace }: TextInputProps & { rows?: number }) {
  const [draft, setDraft] = useDraft(value)
  return (
    <textarea
      id={id}
      value={draft}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={joinClassNames(
        'box-border w-full min-w-0 resize-y rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-normal text-ink outline-none focus:border-ink disabled:bg-subtle',
        monospace ? 'font-mono text-[12px]' : '',
      )}
    />
  )
}

interface NumberInputProps {
  id?: string
  value: number | null
  onCommit: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
  disabled?: boolean
  placeholder?: string
  /** Text after the input ("times", "s", "× each time"). */
  suffix?: ReactNode
  wide?: boolean
}

/** Clamps a typed number into `[min, max]`. */
export function clampNumber(value: number, min?: number, max?: number): number {
  let clamped = value
  if (min !== undefined) clamped = Math.max(min, clamped)
  if (max !== undefined) clamped = Math.min(max, clamped)
  return clamped
}

/** A number that commits on blur; empty commits null, values are clamped to min / max. */
export function NumberInput({ id, value, onCommit, min, max, step, ariaLabel, disabled, placeholder, suffix, wide }: NumberInputProps) {
  const text = value === null ? '' : String(value)
  const [draft, setDraft] = useDraft(text)
  const commit = () => {
    if (draft === text) return
    if (draft.trim() === '') {
      onCommit(null)
      return
    }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(text)
      return
    }
    const clamped = clampNumber(parsed, min, max)
    setDraft(String(clamped))
    onCommit(clamped)
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        className={wide ? joinClassNames(inputClassName, 'w-24') : smallInputClassName}
      />
      {suffix}
    </span>
  )
}

export interface ChoiceOption {
  value: string
  label: string
}

/** A native select. */
export function SelectInput({ id, value, options, onChange, ariaLabel, disabled, className }: { id?: string; value: string; options: ChoiceOption[]; onChange: (value: string) => void; ariaLabel?: string; disabled?: boolean; className?: string }) {
  const hasValue = options.some((choice) => choice.value === value)
  return (
    <select id={id} value={value} aria-label={ariaLabel} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={joinClassNames(inputClassName, 'cursor-pointer', className)}>
      {!hasValue && <option value={value}>{value || 'Choose…'}</option>}
      {options.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

/** A checkbox row with a title and an explanation. */
export function ToggleRow({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-[15px] w-[15px] cursor-pointer accent-ink" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-ink">
          {label}
        </label>
        {description && <span className={hintClassName}>{description}</span>}
      </span>
    </div>
  )
}

export interface RadioCardOption {
  value: string
  title: string
  description?: ReactNode
  disabled?: boolean
}

/** Radio cards ("Stop the run" / "Go to the error path" / …). */
export function RadioCards({ legend, name, value, options, onChange, disabled }: { legend: string; name: string; value: string; options: RadioCardOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const groupName = `${name}-${useId()}`
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className={joinClassNames(labelClassName, 'mb-1.5 p-0')}>{legend}</legend>
      {options.map((choice) => {
        const isChecked = choice.value === value
        return (
          <label
            key={choice.value}
            className={joinClassNames(
              'flex gap-2 rounded-[10px] px-2.5 py-2',
              isChecked ? 'border-2 border-ink' : 'border border-line-strong',
              choice.disabled || disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={choice.value}
              checked={isChecked}
              disabled={choice.disabled || disabled}
              onChange={() => onChange(choice.value)}
              className="mt-0.5 h-[15px] w-[15px] accent-ink"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-ink">{choice.title}</span>
              {choice.description && <span className={hintClassName}>{choice.description}</span>}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

/** Two or more exclusive choices as a segmented control ("all (and)" / "any (or)"). */
export function SegmentedChoice({ label, value, options, onChange, disabled }: { label: string; value: string; options: ChoiceOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 self-start rounded-lg bg-chip p-0.5">
      {options.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          disabled={disabled}
          onClick={() => onChange(choice.value)}
          className={joinClassNames(
            'h-7 cursor-pointer rounded-md border-0 px-2.5 text-[12px] font-medium',
            choice.value === value ? 'bg-surface text-ink shadow-sm' : 'bg-transparent text-muted hover:text-ink',
          )}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}

/** The small ✕ that removes a row. */
export function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-chip hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
      <Icon name="close" size={12} />
    </button>
  )
}

/** "Add a value", "Add a case"… */
export function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={linkButtonClassName}>
      {children}
    </button>
  )
}

/** Amber "Needs app support" note from the spec. */
export function SupportNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[12px] leading-normal text-amber-deep">
      <b className="font-semibold">Needs app support:</b> {children}
    </p>
  )
}

/** A step's outputs with their type hints. */
export function OutputsList({ outputs, footnote }: { outputs: Array<{ name: string; hint: string }>; footnote?: ReactNode }) {
  if (outputs.length === 0 && !footnote) return null
  return (
    <InspectorSection title="Outputs" defaultOpen={false}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {outputs.map((output) => (
          <li key={output.name} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="font-mono text-ink">{output.name}</span>
            <span className="text-right text-muted">{output.hint}</span>
          </li>
        ))}
      </ul>
      {footnote && <p className={hintClassName}>{footnote}</p>}
    </InspectorSection>
  )
}
