import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'

/** One setting a plugin reads (an environment variable), with whether it has a value. */
export interface PluginConfigField {
  variable: string
  /** Friendlier label, e.g. "Access token"; the variable name is shown either way. */
  label?: string
  configured: boolean
}

interface PluginConfigFormProps {
  pluginName: string
  fields: PluginConfigField[]
  /** Saves a value to the keychain; rejects with the error to show. */
  onSave: (variable: string, value: string) => Promise<void>
  /** Clears a stored value; rejects with the error to show. */
  onClear: (variable: string) => Promise<void>
}

interface PluginConfigRowProps {
  pluginName: string
  field: PluginConfigField
  onSave: (value: string) => Promise<void>
  onClear: () => Promise<void>
}

/** One password input with Save / Clear. The stored value is never shown, only "Saved". */
function PluginConfigRow({ pluginName, field, onSave, onClear }: PluginConfigRowProps) {
  const inputId = useId()
  const [value, setValue] = useState('')
  const [pendingAction, setPendingAction] = useState<'saving' | 'clearing' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isBusy = pendingAction !== null
  const label = field.label ? `${field.label} (${field.variable})` : field.variable

  async function runAction(action: 'saving' | 'clearing', work: () => Promise<void>) {
    setPendingAction(action)
    setErrorMessage(null)
    try {
      await work()
      setValue('')
    } catch (actionError) {
      setErrorMessage(`Could not ${action === 'saving' ? 'save' : 'clear'} ${field.variable}: ${describeError(actionError)}`)
    } finally {
      setPendingAction(null)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (value.trim() === '' || isBusy) return
    void runAction('saving', () => onSave(value))
  }

  return (
    <form onSubmit={handleSubmit} aria-label={`${pluginName} setting ${field.variable}`} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="min-w-0 text-[12px] font-medium text-ink-2 [overflow-wrap:anywhere]">
          {label}
        </label>
        <span className={field.configured ? 'shrink-0 text-[12px] font-medium text-ok-strong' : 'shrink-0 text-[12px] text-muted'}>{field.configured ? 'Saved' : 'Not set'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          placeholder={field.configured ? 'Paste a new value to replace it' : 'Paste the value'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="box-border h-8 min-w-0 flex-[1_1_180px] rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
        />
        <Button type="submit" size="sm" aria-label={`Save ${field.variable}`} disabled={isBusy || value.trim() === ''}>
          {pendingAction === 'saving' ? 'Saving…' : 'Save'}
        </Button>
        {field.configured && (
          <Button variant="secondary" size="sm" aria-label={`Clear ${field.variable}`} disabled={isBusy} onClick={() => void runAction('clearing', onClear)}>
            {pendingAction === 'clearing' ? 'Clearing…' : 'Clear'}
          </Button>
        )}
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {errorMessage}
        </p>
      )}
    </form>
  )
}

/**
 * Settings a plugin requests, one password input each. Values go to the OS keychain and
 * are never read back: each row only says "Saved" or "Not set".
 */
export function PluginConfigForm({ pluginName, fields, onSave, onClear }: PluginConfigFormProps) {
  if (fields.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map((field) => (
        <PluginConfigRow
          key={field.variable}
          pluginName={pluginName}
          field={field}
          onSave={(value) => onSave(field.variable, value)}
          onClear={() => onClear(field.variable)}
        />
      ))}
      <span className="text-[12px] text-muted">Saved in the keychain on this computer, never shown again</span>
    </div>
  )
}
