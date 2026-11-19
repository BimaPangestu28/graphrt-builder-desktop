import { useState, type FormEvent } from 'react'
import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { deleteWorkflowSecret, setWorkflowSecret } from '@/api/credentials'
import { joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { formatSavedAt } from '@/pages/version-history/formatSavedAt'
import { AddSecretForm } from './AddSecretForm'
import { describeSecretUsers, isSecretMissing } from './secretDisplay'
import { SecretValueInput } from './SecretValueInput'

const rowClassNames = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-chip last:border-b-0'
const textButtonClassNames =
  'cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ink-2 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50'
const smallButtonClassNames = 'h-8 cursor-pointer rounded-lg px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClassNames = `${smallButtonClassNames} border-0 bg-ink text-white hover:bg-ink-2`
const secondaryButtonClassNames = `${smallButtonClassNames} border border-line-strong bg-surface text-ink hover:bg-subtle`

interface SecretValueFormProps {
  secret: WorkflowSecretOverview
  onSave: (value: string) => Promise<void>
  onCancel: () => void
}

/** Inline password field to add or replace one secret's value (never shown again). */
function SecretValueForm({ secret, onSave, onCancel }: SecretValueFormProps) {
  const [secretValue, setSecretValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const canSave = secretValue.trim().length > 0 && !isSaving

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await onSave(secretValue)
    } catch (saveError) {
      setErrorMessage(`Could not save ${secret.name}: ${describeError(saveError)}`)
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={`${secret.name} value`} className="flex w-full flex-wrap items-center gap-2">
      <SecretValueInput
        label={`Value of ${secret.name}`}
        value={secretValue}
        onChange={setSecretValue}
        placeholder={secret.configured ? 'Paste the new value' : 'Paste the value'}
        autoFocus
      />
      <button type="submit" disabled={!canSave} className={primaryButtonClassNames}>
        {isSaving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} className={secondaryButtonClassNames}>
        Cancel
      </button>
      <span className="w-full text-[12px] text-muted">Saved in the keychain, never shown again</span>
      {errorMessage && (
        <span aria-live="polite" className="w-full text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
    </form>
  )
}

interface RemoveConfirmationProps {
  secret: WorkflowSecretOverview
  isRemoving: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** "Remove MY_TOKEN?" with what stops working, before the value is deleted. */
function RemoveConfirmation({ secret, isRemoving, onConfirm, onCancel }: RemoveConfirmationProps) {
  const consequence =
    secret.agents.length + secret.mcpServers.length > 0
      ? `${describeSecretUsers(secret).replace('Used by ', '')} will stop working until you add it again.`
      : 'Agents can no longer use it.'
  return (
    <div role="alertdialog" aria-label={`Remove ${secret.name}?`} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-danger-tint px-3 py-2">
      <span className="flex-auto text-[13px] text-danger-deep">
        Remove {secret.name} from the keychain? {consequence}
      </span>
      <button type="button" disabled={isRemoving} onClick={onConfirm} className={`${smallButtonClassNames} border-0 bg-danger text-white`}>
        {isRemoving ? 'Removing…' : `Yes, remove ${secret.name}`}
      </button>
      <button type="button" onClick={onCancel} className={secondaryButtonClassNames}>
        Keep it
      </button>
    </div>
  )
}

function describeSecretDetails(secret: WorkflowSecretOverview): string {
  const details = [secret.description ? secret.name : null, secret.note, describeSecretUsers(secret)]
  if (secret.configured && secret.updatedAt) details.push(`Saved ${formatSavedAt(secret.updatedAt)}`)
  return details.filter(Boolean).join(' · ')
}

function SecretStatus({ secret }: { secret: WorkflowSecretOverview }) {
  if (secret.configured) return <span className="text-[13px] text-ok-strong">Saved</span>
  return <span className={joinClassNames('text-[13px]', isSecretMissing(secret) ? 'text-danger' : 'text-muted')}>{isSecretMissing(secret) ? 'Missing' : 'Optional'}</span>
}

interface SecretRowProps {
  secret: WorkflowSecretOverview
  /** Reloads the list after a value was saved or removed. */
  onChanged: () => Promise<void>
}

/** One secret: what it is, who uses it, whether it is saved, and Add value / Replace / Remove. */
function SecretRow({ secret, onChanged }: SecretRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeErrorMessage, setRemoveErrorMessage] = useState<string | null>(null)
  const isMissing = isSecretMissing(secret)

  async function saveValue(secretValue: string) {
    await setWorkflowSecret(secret.name, secretValue)
    await onChanged()
    setIsEditing(false)
  }

  async function removeValue() {
    setIsRemoving(true)
    setRemoveErrorMessage(null)
    try {
      await deleteWorkflowSecret(secret.name)
      setIsConfirmingRemove(false)
      await onChanged()
    } catch (removeError) {
      setRemoveErrorMessage(`Could not remove ${secret.name}: ${describeError(removeError)}`)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div role="listitem" aria-label={secret.name} className={rowClassNames}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={joinClassNames('font-medium', !secret.description && 'font-mono text-[13px]')}>{secret.description ?? secret.name}</span>
        <span className="text-[12px] text-muted">{describeSecretDetails(secret)}</span>
      </span>
      {!isEditing && !isConfirmingRemove && (
        <span className="flex items-center gap-3">
          <SecretStatus secret={secret} />
          <button type="button" aria-label={`${secret.configured ? 'Replace' : 'Add'} ${secret.name}`} onClick={() => setIsEditing(true)} className={textButtonClassNames}>
            {secret.configured ? 'Replace value' : isMissing ? 'Missing — add value' : 'Add value'}
          </button>
          {(secret.configured || secret.createdAt) && (
            <button type="button" aria-label={`Remove ${secret.name}`} onClick={() => setIsConfirmingRemove(true)} className={textButtonClassNames}>
              Remove
            </button>
          )}
        </span>
      )}
      {isEditing && <SecretValueForm secret={secret} onSave={saveValue} onCancel={() => setIsEditing(false)} />}
      {isConfirmingRemove && (
        <RemoveConfirmation secret={secret} isRemoving={isRemoving} onConfirm={() => void removeValue()} onCancel={() => setIsConfirmingRemove(false)} />
      )}
      {removeErrorMessage && (
        <span aria-live="polite" className="w-full text-[13px] text-danger">
          {removeErrorMessage}
        </span>
      )}
    </div>
  )
}

/** Loaded secrets plus load state, as the Connections page hands them down. */
export interface SecretsListState {
  /** Every secret; null while loading. */
  allSecrets: WorkflowSecretOverview[] | null
  /** Secrets matching the search; null while loading. */
  visibleSecrets: WorkflowSecretOverview[] | null
  loadError: Error | null
  isSearching: boolean
  reload: () => Promise<void>
}

function SecretsNotice({ text }: { text: string }) {
  return <p className="m-0 px-4 py-3 text-[13px] text-muted">{text}</p>
}

/**
 * The Secrets panel under Advanced: "Add secret", then every secret the user saved or an
 * agent (or MCP server) reads, from `listAllWorkflowSecrets`. Values go to the keychain
 * and are never shown; agents read a secret as `{{#env.NAME#}}`.
 */
export function SecretsPanel({ secretsState }: { secretsState: SecretsListState }) {
  const { visibleSecrets, loadError, isSearching, reload } = secretsState
  return (
    <section aria-label="Secrets" className="rounded-xl border border-line">
      {!isSearching && <AddSecretForm onAdded={reload} />}
      {loadError && <SecretsNotice text={`Could not load secrets: ${describeError(loadError)}`} />}
      {!loadError && !visibleSecrets && <SecretsNotice text="Loading secrets…" />}
      {!loadError && visibleSecrets?.length === 0 && !isSearching && (
        <SecretsNotice text="No secrets yet. Add one above; ones your agents use appear here too" />
      )}
      {visibleSecrets && visibleSecrets.length > 0 && (
        <div role="list" aria-label="Saved and needed secrets">
          {visibleSecrets.map((secret) => (
            <SecretRow key={secret.name} secret={secret} onChanged={reload} />
          ))}
        </div>
      )}
    </section>
  )
}
