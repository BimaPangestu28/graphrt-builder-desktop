import { useState, type ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { checkReference, type ValueGroup } from './availableValues'
import { Field, linkButtonClassName, RemoveButton } from './fields'
import { useInspector } from './InspectorContext'
import { describeReference } from './references'
import { ValuePicker } from './ValuePicker'

/**
 * A field that holds one value reference (a graphrt selector `[node, field, ...]`):
 * Items of For each, Read from, Search for, a condition's left side. Shows the chosen
 * value as a chip with where it comes from, or a button to pick one.
 */
interface SelectorChipProps {
  path: string[] | null
  onChange: (path: string[] | null) => void
  ariaLabel: string
  /** Text of the pick button when empty. */
  emptyLabel?: string
  compact?: boolean
  /** Values to offer instead of the node's own (For each › Collect offers the body's outputs). */
  groups?: ValueGroup[]
}

/** The chip + picker without a label (inside condition rows). */
export function SelectorChip({ path, onChange, ariaLabel, emptyLabel = 'Pick a value', compact = false, groups }: SelectorChipProps) {
  const { graph, valueGroups: ownGroups, readOnly } = useInspector()
  const valueGroups = groups ?? ownGroups
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const check = path ? checkReference(path, graph, valueGroups) : null
  const source = path ? valueGroups.find((group) => group.options.some((valueOption) => valueOption.path[0] === path[0])) : undefined
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        className={joinClassNames(
          'box-border flex min-h-8 min-w-0 flex-wrap items-center gap-1.5 rounded-[9px] border bg-surface px-2 py-1',
          check && check.status !== 'ok' ? (check.status === 'unknown-step' ? 'border-danger' : 'border-amber-line') : 'border-line-strong',
        )}
      >
        {path ? (
          <>
            <button
              type="button"
              aria-label={`${ariaLabel}: ${describeReference(path, graph)}. Change`}
              title={path.join('.')}
              disabled={readOnly}
              onClick={() => setIsPickerOpen((open) => !open)}
              className={joinClassNames(
                'max-w-full cursor-pointer truncate rounded-[5px] border-0 px-[5px] text-[13px] font-medium',
                check?.status === 'unknown-step' ? 'bg-danger-soft text-danger' : check?.status === 'out-of-scope' ? 'bg-amber-soft text-amber-strong' : 'bg-brand-soft text-brand-strong',
              )}
            >
              {describeReference(path, graph)}
            </button>
            {!compact && source && <span className="truncate text-[12px] text-muted">{source.title}</span>}
            <span className="ml-auto">
              <RemoveButton label={`Remove ${ariaLabel}`} disabled={readOnly} onClick={() => onChange(null)} />
            </span>
          </>
        ) : (
          <button type="button" aria-label={`${ariaLabel}: ${emptyLabel}`} disabled={readOnly} className={linkButtonClassName} onClick={() => setIsPickerOpen((open) => !open)}>
            {emptyLabel}
          </button>
        )}
      </div>
      {check && check.message && (
        <p role="alert" className={joinClassNames('m-0 text-[12px]', check.status === 'unknown-step' ? 'text-danger' : 'text-amber-strong')}>
          {check.message}
        </p>
      )}
      {isPickerOpen && (
        <ValuePicker
          groups={valueGroups}
          selectedPath={path}
          label={`Values for ${ariaLabel}`}
          onPick={(picked) => {
            setIsPickerOpen(false)
            onChange(picked)
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  )
}

interface SelectorFieldProps {
  label: string
  path: string[] | null
  onChange: (path: string[] | null) => void
  required?: boolean
  hint?: ReactNode
  error?: string | null
}

/** A labelled {@link SelectorChip}. */
export function SelectorField({ label, path, onChange, required, hint, error }: SelectorFieldProps) {
  return (
    <Field label={label} required={required} hint={hint} error={error ?? (required && !path ? 'Required' : null)}>
      <SelectorChip path={path} onChange={onChange} ariaLabel={label} />
    </Field>
  )
}
