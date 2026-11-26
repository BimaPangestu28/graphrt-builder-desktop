import { useState, type FormEvent } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { deleteWorkflowSecret, setWorkflowSecret } from '@/api/credentials'
import { Badge, Button, joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { formatSavedAt } from '@/pages/version-history/formatSavedAt'
import { ConnectionsNotice, connectionsCardClassNames } from './ConnectionsSection'
import { describeSecretUsers, isSecretMissing, listSecretUsers } from './secretDisplay'
import { SecretValueInput } from './SecretValueInput'
import { messages } from '@/i18n'

const rowClassNames = 'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-chip px-4 py-3 last:border-b-0'

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
      setErrorMessage(messages().connections.couldNotSaveNameReason(secret.name, describeError(saveError)))
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={messages().connections.nameValue(secret.name)} className="flex w-full flex-wrap items-center gap-2">
      <SecretValueInput
        label={messages().connections.valueOfName(secret.name)}
        value={secretValue}
        onChange={setSecretValue}
        placeholder={secret.configured ? messages().connections.pasteTheNewValue : messages().connections.pasteTheValue}
        autoFocus
        className="flex-[1_1_240px]"
      />
      <Button type="submit" size="sm" disabled={!canSave}>
        {isSaving ? messages().connections.saving : messages().connections.save}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {messages().connections.cancel}
      </Button>
      <span className="w-full text-[12px] text-muted">{messages().connections.savedIn}{' '}{getCredentialStoreName()}{messages().connections.neverShownAgain}</span>
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
      ? messages().connections.willStopWorking(listSecretUsers(secret))
      : messages().connections.agentsCanNoLongerUseIt
  return (
    <div role="alertdialog" aria-label={messages().connections.removeName2(secret.name)} className="flex w-full flex-wrap items-center gap-2 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2">
      <span className="flex-[1_1_240px] text-[13px] leading-normal text-danger-deep [overflow-wrap:anywhere]">
        {messages().connections.remove}{' '}{secret.name} {messages().connections.from}{' '}{getCredentialStoreName()}? {consequence}
      </span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {messages().connections.keepIt}
      </Button>
      <Button size="sm" disabled={isRemoving} onClick={onConfirm} className="!border-danger !bg-danger hover:!bg-danger-deep">
        {isRemoving ? messages().connections.removing : messages().connections.yesRemoveName(secret.name)}
      </Button>
    </div>
  )
}

function describeSecretDetails(secret: WorkflowSecretOverview): string {
  const details = [secret.description ? secret.name : null, secret.note, describeSecretUsers(secret)]
  if (secret.configured && secret.updatedAt) details.push(messages().connections.savedSavedat(formatSavedAt(secret.updatedAt)))
  return details.filter(Boolean).join(' · ')
}

function SecretStatus({ secret }: { secret: WorkflowSecretOverview }) {
  if (secret.configured) return <Badge tone="ok">{messages().connections.saved}</Badge>
  return isSecretMissing(secret) ? <Badge tone="danger">{messages().connections.missing}</Badge> : <Badge>{messages().connections.optional}</Badge>
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
      setRemoveErrorMessage(messages().connections.couldNotRemoveNameReason(secret.name, describeError(removeError)))
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div role="listitem" aria-label={secret.name} className={rowClassNames}>
      <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
        <span className={joinClassNames('font-medium [overflow-wrap:anywhere]', !secret.description && 'font-mono text-[13px]')}>{secret.description ?? secret.name}</span>
        <span className="text-[12px] leading-normal text-muted [overflow-wrap:anywhere]">{describeSecretDetails(secret)}</span>
      </span>
      {!isEditing && !isConfirmingRemove && (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <SecretStatus secret={secret} />
          <Button
            variant={isMissing ? 'primary' : 'secondary'}
            size="sm"
            aria-label={`${secret.configured ? 'Replace' : 'Add'} ${secret.name}`}
            onClick={() => setIsEditing(true)}
          >
            {secret.configured ? messages().connections.replace : messages().connections.addValue}
          </Button>
          {(secret.configured || secret.createdAt) && (
            <Button variant="ghost" size="sm" aria-label={messages().connections.removeName(secret.name)} onClick={() => setIsConfirmingRemove(true)} className="!text-danger hover:!bg-danger-tint">
              {messages().connections.remove}
            </Button>
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
  secrets: WorkflowSecretOverview[] | null
  loadError: Error | null
  reload: () => Promise<void>
}

/**
 * Every secret the user saved or an agent (or MCP server) reads, from
 * `listAllWorkflowSecrets`, as rows in one card. Values go to the keychain and are never
 * shown; agents read a secret as `{{#env.NAME#}}`.
 */
export function SecretsList({ secretsState }: { secretsState: SecretsListState }) {
  const { secrets, loadError, reload } = secretsState
  if (loadError) return <ConnectionsNotice tone="danger">{messages().connections.couldNotLoadSecrets}{' '}{describeError(loadError)}</ConnectionsNotice>
  if (!secrets) return <ConnectionsNotice>{messages().connections.loadingSecrets}</ConnectionsNotice>
  if (secrets.length === 0) return <ConnectionsNotice>{messages().connections.noSecretsYetUseAddSecret}</ConnectionsNotice>
  return (
    <div role="list" aria-label={messages().connections.savedAndNeededSecrets} className={connectionsCardClassNames}>
      {secrets.map((secret) => (
        <SecretRow key={secret.name} secret={secret} onChanged={reload} />
      ))}
    </div>
  )
}
