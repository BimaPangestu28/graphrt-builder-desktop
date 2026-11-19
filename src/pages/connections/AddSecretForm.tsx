import { useState, type FormEvent } from 'react'
import { addWorkflowSecret } from '@/api/credentials'
import { describeError } from '@/lib/agentDisplay'
import { describeSecretNameProblem, normalizeSecretName } from './secretDisplay'
import { SecretValueInput } from './SecretValueInput'

const fieldLabelClassNames = 'flex flex-col gap-1 text-[12px] font-medium text-muted'
const textInputClassNames =
  'box-border h-9 min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-ink'

interface AddSecretFormProps {
  /** Reloads the list after the secret was saved. */
  onAdded: () => Promise<void>
}

/**
 * "Add secret": a name (UPPER_SNAKE_CASE, typed letters are capitalised), the value in a
 * password field with Show / Hide, and an optional note. The value goes to the keychain
 * and is never shown again; agents read it as `{{#env.NAME#}}`.
 */
export function AddSecretForm({ onAdded }: AddSecretFormProps) {
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
      await onAdded()
    } catch (saveError) {
      setErrorMessage(`Could not save ${name}: ${describeError(saveError)}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add a secret" className="flex flex-col gap-3 border-b border-chip px-4 py-3.5">
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Add secret</span>
        <span className="text-[12px] text-muted">Server logins, API tokens, database passwords. Saved in the keychain, never shown again</span>
      </span>
      <div className="flex flex-wrap gap-3">
        <label className={`${fieldLabelClassNames} flex-[1_1_200px]`}>
          Name
          <input
            type="text"
            value={secretName}
            placeholder="MY_SERVER_TOKEN"
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
          Value
          <SecretValueInput label="Value" value={secretValue} onChange={setSecretValue} placeholder="Paste the value" />
        </span>
      </div>
      <label className={fieldLabelClassNames}>
        Note (optional)
        <input
          type="text"
          value={secretNote}
          maxLength={200}
          placeholder="e.g. Deploy token for my home server"
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
          Paste the value to save
        </span>
      )}
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      {savedName && !errorMessage && (
        <span aria-live="polite" className="text-[13px] text-ok-strong">
          {savedName} is saved in the keychain. Agents read it as {`{{#env.${savedName}#}}`}
        </span>
      )}
      <span>
        <button
          type="submit"
          disabled={isSaving}
          className="h-8 cursor-pointer rounded-lg border-0 bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save secret'}
        </button>
      </span>
    </form>
  )
}
