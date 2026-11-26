import { useId, useState, type FormEvent } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { Badge, Button, joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { messages } from '@/i18n'

/** One setting a plugin reads (an environment variable), with whether it has a value. */
export interface PluginConfigField {
  variable: string
  /** Friendlier label, e.g. "Access token"; the variable name is shown either way. */
  label?: string
  configured: boolean
}

interface PluginConfigFormProps {
  /** The plugin's display name, for the form labels. */
  pluginLabel: string
  fields: PluginConfigField[]
  /** Saves a value to the keychain; rejects with the error to show. */
  onSave: (variable: string, value: string) => Promise<void>
  /** Clears a stored value; rejects with the error to show. */
  onClear: (variable: string) => Promise<void>
}

interface PluginConfigRowProps {
  pluginLabel: string
  field: PluginConfigField
  onSave: (value: string) => Promise<void>
  onClear: () => Promise<void>
}

/** One password input with Save / Clear. The stored value is never shown, only "Saved". */
function PluginConfigRow({ pluginLabel, field, onSave, onClear }: PluginConfigRowProps) {
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
      const t = messages().plugins
      setErrorMessage(action === 'saving' ? t.couldNotSaveSetting(field.variable, describeError(actionError)) : t.couldNotClearSetting(field.variable, describeError(actionError)))
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
    <form onSubmit={handleSubmit} aria-label={messages().plugins.settingForm(pluginLabel, field.variable)} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className={joinClassNames('min-w-0 text-[12px] font-medium text-ink-2 [overflow-wrap:anywhere]', !field.label && 'font-mono')}>
          {label}
        </label>
        <Badge tone={field.configured ? 'ok' : 'neutral'} className="shrink-0 px-2 text-[11px]">
          {field.configured ? messages().plugins.saved : messages().plugins.notSet}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          placeholder={field.configured ? messages().plugins.pasteNewValue : messages().plugins.pasteValue}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="box-border h-8 min-w-0 flex-[1_1_180px] rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
        />
        <Button type="submit" variant="secondary" size="sm" aria-label={messages().plugins.saveSetting(field.variable)} disabled={isBusy || value.trim() === ''}>
          {pendingAction === 'saving' ? messages().plugins.saving : messages().plugins.save}
        </Button>
        {field.configured && (
          <Button variant="ghost" size="sm" aria-label={messages().plugins.clearSetting(field.variable)} disabled={isBusy} onClick={() => void runAction('clearing', onClear)}>
            {pendingAction === 'clearing' ? messages().plugins.clearing : messages().plugins.clear}
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
export function PluginConfigForm({ pluginLabel, fields, onSave, onClear }: PluginConfigFormProps) {
  if (fields.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map((field) => (
        <PluginConfigRow
          key={field.variable}
          pluginLabel={pluginLabel}
          field={field}
          onSave={(value) => onSave(field.variable, value)}
          onClear={() => onClear(field.variable)}
        />
      ))}
      <span className="text-[12px] text-muted">Saved in {getCredentialStoreName()}, never shown again</span>
    </div>
  )
}
