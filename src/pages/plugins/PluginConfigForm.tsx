import { useId, useState, type FormEvent } from 'react'
import { pickPluginSettingPath } from '@/api/plugins'
import type { PluginConfigStatus, PluginSettingKind } from '@/api/pluginTypes'
import { getCredentialStoreName } from '@/lib/platform'
import { Badge, Button, joinClassNames } from '@/components/ui'
import { ErrorHelpNotice } from '@/components/errors/ErrorHelpNotice'
import { describeError } from '@/lib/agentDisplay'
import { explainBackendError } from '@/lib/errorHelp'
import { messages } from '@/i18n'

/** One setting a plugin reads (an environment variable), with what it is and whether it has a value. */
export interface PluginConfigField {
  variable: string
  /** What people see instead of the variable name, e.g. "Folder for finished documents". */
  label?: string | null
  /** One or two sentences under the label. */
  help?: string | null
  /** Missing means `secret`: a password input whose value is never shown again. */
  kind?: PluginSettingKind
  /** What the plugin uses when the setting has no value, shown as a hint. */
  defaultValue?: string | null
  /** The value is a comma-separated list (several folders or files). */
  multiple?: boolean
  /** The saved value (never set for a secret). */
  value?: string | null
  configured: boolean
}

/** A save or clear that failed, with what it rejected with. */
interface SettingFailure {
  action: 'saving' | 'clearing'
  error: unknown
}

/**
 * Why a setting was not saved: a known error kind in plain words with the backend's message
 * under it, else the message in one line.
 */
function SettingFailureNotice({ failure, settingName }: { failure: SettingFailure; settingName: string }) {
  const help = explainBackendError(failure.error)
  const reason = describeError(failure.error)
  const t = messages()
  if (!help) {
    return (
      <p role="alert" className="m-0 text-[12px] text-danger">
        {failure.action === 'saving' ? t.plugins.couldNotSaveSetting(settingName, reason) : t.plugins.couldNotClearSetting(settingName, reason)}
      </p>
    )
  }
  const title = failure.action === 'saving' ? t.errorHelp.settingNotSaved(settingName) : t.errorHelp.settingNotCleared(settingName)
  const nextStep = help.family === 'invalidInput' || help.family === 'notFound' ? t.errorHelp.checkTheSetting : undefined
  return <ErrorHelpNotice help={help} title={title} detail={reason} nextStep={nextStep} hidesRemedy className="text-[13px]" />
}

/** The form field of a setting as the backend lists it. */
export function toPluginConfigField(setting: PluginConfigStatus): PluginConfigField {
  return {
    variable: setting.name,
    label: setting.label,
    help: setting.help,
    kind: setting.kind,
    defaultValue: setting.defaultValue,
    multiple: setting.multiple,
    value: setting.value,
    configured: setting.configured,
  }
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

function isSecretField(field: PluginConfigField): boolean {
  return (field.kind ?? 'secret') === 'secret'
}

function describePlaceholder(field: PluginConfigField): string {
  const t = messages().plugins
  if (isSecretField(field)) return field.configured ? t.pasteNewValue : t.pasteValue
  if (field.defaultValue) return t.defaultIs(field.defaultValue)
  if (field.kind === 'folder') return t.folderPlaceholder
  if (field.kind === 'file') return t.filePlaceholder
  return field.kind === 'number' ? t.typeNumber : t.typeValue
}

/** The label of the picker button: "Choose" for one path, "Add" once a list has an entry. */
function describePickAction(kind: 'folder' | 'file', isAdding: boolean): string {
  const t = messages().plugins
  if (kind === 'folder') return isAdding ? t.addFolder : t.chooseFolder
  return isAdding ? t.addFile : t.chooseFile
}

/**
 * One setting with Save / Clear. A secret is a password input whose stored value is never
 * shown, only "Saved"; any other setting shows its saved value and can be edited. A folder
 * or file setting also gets a picker, which saves what was picked right away.
 */
function PluginConfigRow({ pluginLabel, field, onSave, onClear }: PluginConfigRowProps) {
  const inputId = useId()
  const helpId = useId()
  const isSecret = isSecretField(field)
  const savedValue = isSecret ? '' : (field.value ?? '')
  const [value, setValue] = useState(savedValue)
  const [pendingAction, setPendingAction] = useState<'saving' | 'clearing' | null>(null)
  const [failure, setFailure] = useState<SettingFailure | null>(null)
  const isBusy = pendingAction !== null
  const t = messages().plugins
  const settingName = field.label ?? field.variable
  const pathKind = field.kind === 'folder' || field.kind === 'file' ? field.kind : null
  const helpText = [field.help, field.kind === 'folder' ? t.folderIsCreated : null].filter(Boolean).join(' ')
  const canSave = !isBusy && value.trim() !== '' && value.trim() !== savedValue

  async function runAction(action: 'saving' | 'clearing', work: () => Promise<void>) {
    setPendingAction(action)
    setFailure(null)
    try {
      await work()
      // A secret is never shown again; any other value comes back from the backend as saved.
      if (isSecret || action === 'clearing') setValue('')
    } catch (actionError) {
      setFailure({ action, error: actionError })
    } finally {
      setPendingAction(null)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSave) void runAction('saving', () => onSave(value))
  }

  async function pickPath(kind: 'folder' | 'file') {
    setFailure(null)
    try {
      const pickedPath = await pickPluginSettingPath(kind, settingName)
      if (pickedPath === null) return
      const nextValue = field.multiple && value.trim() !== '' ? `${value.trim().replace(/,\s*$/, '')}, ${pickedPath}` : pickedPath
      setValue(nextValue)
      await runAction('saving', () => onSave(nextValue))
    } catch (pickError) {
      setFailure({ action: 'saving', error: pickError })
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={t.settingForm(pluginLabel, field.variable)} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          title={field.label ? field.variable : undefined}
          className={joinClassNames('min-w-0 text-[12px] font-medium text-ink-2 [overflow-wrap:anywhere]', !field.label && 'font-mono')}
        >
          {settingName}
        </label>
        <Badge tone={field.configured ? 'ok' : 'neutral'} className="shrink-0 px-2 text-[11px]">
          {field.configured ? t.saved : t.notSet}
        </Badge>
      </div>
      {helpText && (
        <span id={helpId} className="text-[12px] leading-normal text-muted">
          {helpText}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type={isSecret ? 'password' : 'text'}
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={helpText ? helpId : undefined}
          placeholder={describePlaceholder(field)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="box-border h-8 min-w-0 flex-[1_1_180px] rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
        />
        {pathKind && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={pathKind === 'folder' ? t.chooseFolderFor(settingName) : t.chooseFileFor(settingName)}
            disabled={isBusy}
            onClick={() => void pickPath(pathKind)}
          >
            {describePickAction(pathKind, Boolean(field.multiple) && value.trim() !== '')}
          </Button>
        )}
        <Button type="submit" variant="secondary" size="sm" aria-label={t.saveSetting(settingName)} disabled={!canSave}>
          {pendingAction === 'saving' ? t.saving : t.save}
        </Button>
        {field.configured && (
          <Button variant="ghost" size="sm" aria-label={t.clearSetting(settingName)} disabled={isBusy} onClick={() => void runAction('clearing', onClear)}>
            {pendingAction === 'clearing' ? t.clearing : t.clear}
          </Button>
        )}
      </div>
      {failure && <SettingFailureNotice failure={failure} settingName={settingName} />}
    </form>
  )
}

/**
 * Settings a plugin requests, one row each: a label and help when the plugin gives them, a
 * folder or file picker where the value is a path, and a password input only for secrets.
 * Values go to the OS keychain; a secret is never read back, its row only says "Saved".
 */
export function PluginConfigForm({ pluginLabel, fields, onSave, onClear }: PluginConfigFormProps) {
  if (fields.length === 0) return null
  const hasSecret = fields.some(isSecretField)
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map((field) => (
        <PluginConfigRow
          // A saved value that changed (the backend stores the full path) starts the row over with it.
          key={`${field.variable}:${field.value ?? ''}`}
          pluginLabel={pluginLabel}
          field={field}
          onSave={(value) => onSave(field.variable, value)}
          onClear={() => onClear(field.variable)}
        />
      ))}
      {hasSecret && (
        <span className="text-[12px] text-muted">{messages().plugins.savedIn}{' '}{getCredentialStoreName()}{messages().plugins.neverShownAgain}</span>
      )}
    </div>
  )
}
