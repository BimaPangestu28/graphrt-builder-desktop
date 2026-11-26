import { useState, type FormEvent } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { addWorkflowSecret } from '@/api/credentials'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { connectionsCardClassNames } from './ConnectionsSection'
import { describeSecretNameProblem, normalizeSecretName } from './secretDisplay'
import { SecretValueInput } from './SecretValueInput'
import { messages } from '@/i18n'

const fieldLabelClassNames = 'flex flex-col gap-1 text-[12px] font-medium text-muted'
const textInputClassNames =
  'box-border h-9 min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-ink'

interface AddSecretFormProps {
  /** Reloads the list after the secret was saved; gets the saved name (never the value). */
  onAdded: (secretName: string) => Promise<void>
  /** Folds the form away again. */
  onClose: () => void
}

/**
 * "Add secret": a name (UPPER_SNAKE_CASE, typed letters are capitalised), the value in a
 * password field with Show / Hide, and an optional note. The value goes to the keychain
 * and is never shown again; agents read it as `{{#env.NAME#}}`.
 */
export function AddSecretForm({ onAdded, onClose }: AddSecretFormProps) {
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [secretNote, setSecretNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasTriedSaving, setHasTriedSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const nameProblem = describeSecretNameProblem(secretName)
  const shownNameProblem = hasTriedSaving || secretName.length > 0 ? nameProblem : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setHasTriedSaving(true)
    if (nameProblem || !secretValue.trim() || isSaving) return
    setIsSaving(true)
    setErrorMessage(null)
    const name = secretName.trim()
    try {
      await addWorkflowSecret({ name, value: secretValue, note: secretNote.trim() || null })
      setSecretName('')
      setSecretValue('')
      setSecretNote('')
      setHasTriedSaving(false)
      setSavedName(name)
      await onAdded(name)
    } catch (saveError) {
      setErrorMessage(messages().connections.couldNotSaveNameReason(name, describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={messages().connections.addASecret} className={`flex flex-col gap-3 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${connectionsCardClassNames}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{messages().connections.addASecret}</span>
        <span className="text-[12px] text-muted">{messages().connections.serverLoginsApiTokensDatabasePasswords}{' '}{getCredentialStoreName()}{messages().connections.neverShownAgain}</span>
      </span>
      <div className="flex flex-wrap gap-3">
        <label className={`${fieldLabelClassNames} flex-[1_1_200px]`}>
          {messages().connections.name}
          <input
            type="text"
            value={secretName}
            placeholder={messages().connections.myServerToken}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={shownNameProblem ? true : undefined}
            onChange={(event) => {
              setSecretName(normalizeSecretName(event.target.value))
              setSavedName(null)
            }}
            className={`${textInputClassNames} font-mono`}
          />
        </label>
        <span className={`${fieldLabelClassNames} flex-[1_1_240px]`}>
          {messages().connections.value}
          <SecretValueInput label={messages().connections.value} value={secretValue} onChange={setSecretValue} placeholder={messages().connections.pasteTheValue} />
        </span>
      </div>
      <label className={fieldLabelClassNames}>
        {messages().connections.noteOptional}
        <input
          type="text"
          value={secretNote}
          maxLength={200}
          placeholder={messages().connections.eGDeployTokenForMy}
          onChange={(event) => setSecretNote(event.target.value)}
          className={textInputClassNames}
        />
      </label>
      {shownNameProblem && (
        <span role="alert" className="text-[13px] text-danger">
          {shownNameProblem}
        </span>
      )}
      {hasTriedSaving && !shownNameProblem && !secretValue.trim() && (
        <span role="alert" className="text-[13px] text-danger">
          {messages().connections.pasteTheValueToSave}
        </span>
      )}
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      {savedName && !errorMessage && (
        <span aria-live="polite" className="text-[13px] text-ok-strong">
          {savedName} {messages().connections.isSavedIn}{' '}{getCredentialStoreName()}{messages().connections.agentsReadItAs}{' '}{`{{#env.${savedName}#}}`}
        </span>
      )}
      <div className="flex justify-end gap-2 border-t border-chip pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {savedName ? messages().connections.done : messages().connections.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? messages().connections.saving : messages().connections.saveSecret}
        </Button>
      </div>
    </form>
  )
}
