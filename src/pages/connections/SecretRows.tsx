import { useState, type FormEvent } from 'react'
import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { deleteWorkflowSecret, setWorkflowSecret } from '@/api/credentials'
import { joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'

const rowClassNames = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-chip'
const textButtonClassNames =
  'cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ink-2 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50'
const smallButtonClassNames = 'h-8 cursor-pointer rounded-lg px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50'

/**
 * "Used by Maps leads to WhatsApp, MCP server github".
 *
 * @param secret - The secret and who uses it (WorkflowSecretOverview)
 * @returns The usage line, or a note that nothing uses it any more (string)
 */
export function describeSecretUsers(secret: WorkflowSecretOverview): string {
  const users = [...secret.agents.map((agent) => agent.agentName), ...secret.mcpServers.map((serverName) => `MCP server ${serverName}`)]
  return users.length > 0 ? `Used by ${users.join(', ')}` : 'Not used by any agent'
}

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
      <input
        type="password"
        aria-label={`Value of ${secret.name}`}
        placeholder={secret.configured ? 'Paste the new value' : 'Paste the value'}
        value={secretValue}
        autoFocus
        onChange={(event) => setSecretValue(event.target.value)}
        className="box-border h-9 min-w-0 flex-[1_1_240px] rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink"
      />
      <button type="submit" disabled={!canSave} className={`${smallButtonClassNames} border-0 bg-ink text-white hover:bg-ink-2`}>
        {isSaving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} className={`${smallButtonClassNames} border border-line-strong bg-surface text-ink hover:bg-subtle`}>
        Cancel
      </button>
      {errorMessage && (
        <span aria-live="polite" className="w-full text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
    </form>
  )
}

interface SecretRowProps {
  secret: WorkflowSecretOverview
  /** Reloads the list after a value was saved or removed. */
  onChanged: () => Promise<void>
}

/** One secret: what it is, who uses it, whether it is set, and Add / Replace / Remove. */
function SecretRow({ secret, onChanged }: SecretRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeErrorMessage, setRemoveErrorMessage] = useState<string | null>(null)
  const title = secret.description ?? secret.name
  const usersText = describeSecretUsers(secret)

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
      await onChanged()
    } catch (removeError) {
      setRemoveErrorMessage(`Could not remove ${secret.name}: ${describeError(removeError)}`)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className={rowClassNames}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-[12px] text-muted">{secret.description ? `${secret.name} · ${usersText}` : usersText}</span>
      </span>
      {!isEditing && (
        <span className="flex items-center gap-3">
          <span className={joinClassNames('text-[13px]', secret.configured ? 'text-ok-strong' : 'text-danger')}>
            {secret.configured ? 'Connected' : secret.required ? 'Not set' : 'Optional'}
          </span>
          <button type="button" aria-label={`${secret.configured ? 'Replace' : 'Add'} ${secret.name}`} onClick={() => setIsEditing(true)} className={textButtonClassNames}>
            {secret.configured ? 'Replace' : 'Add value'}
          </button>
          {secret.configured && (
            <button type="button" aria-label={`Remove ${secret.name}`} disabled={isRemoving} onClick={() => void removeValue()} className={textButtonClassNames}>
              {isRemoving ? 'Removing…' : 'Remove'}
            </button>
          )}
        </span>
      )}
      {isEditing && <SecretValueForm secret={secret} onSave={saveValue} onCancel={() => setIsEditing(false)} />}
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
  /** Secrets matching the search; null while loading. */
  visibleSecrets: WorkflowSecretOverview[] | null
  loadError: Error | null
  isSearching: boolean
  reload: () => Promise<void>
}

function SecretsNotice({ text }: { text: string }) {
  return (
    <div className={rowClassNames}>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Secrets</span>
        <span className="text-[12px] text-muted">{text}</span>
      </span>
    </div>
  )
}

/**
 * The secret rows at the top of Advanced: every `env.*` value any agent (or MCP server)
 * needs, from `listAllWorkflowSecrets`. Values go to the keychain and are never shown.
 */
export function SecretRows({ secretsState }: { secretsState: SecretsListState }) {
  const { visibleSecrets, loadError, isSearching, reload } = secretsState
  if (loadError) return <SecretsNotice text={`Could not load secrets: ${describeError(loadError)}`} />
  if (!visibleSecrets) return isSearching ? null : <SecretsNotice text="Loading secrets…" />
  if (visibleSecrets.length === 0) {
    return isSearching ? null : <SecretsNotice text="No agent needs an API key or token yet. Ones your agents use appear here" />
  }
  return (
    <>
      {visibleSecrets.map((secret) => (
        <SecretRow key={secret.name} secret={secret} onChanged={reload} />
      ))}
    </>
  )
}
