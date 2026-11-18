import { useState } from 'react'
import { deleteApiKey, setApiKey, setDefaultModel } from '@/api/credentials'
import type { ModelProvider } from '@/api/types'
import { connectionCategoryTitles } from '@/data/connections'
import { describeError } from '@/lib/agentDisplay'
import { recommendedModelFor } from '@/lib/modelChoices'
import { ConnectionCard } from './ConnectionCard'
import type { ModelConnection } from './modelConnections'
import { ProviderKeyForm } from './ProviderKeyForm'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'
const textButtonClassNames = 'cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ink-2 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50'

interface KeyActionsProps {
  connection: ModelConnection
  isRemoving: boolean
  isMakingDefault: boolean
  onReplace: () => void
  onRemove: () => void
  onMakeDefault: () => void
}

/**
 * Actions under a connected provider: "Use by default" when it is not the default model's
 * provider, and "Replace key" / "Remove" when it has a key in the keychain.
 */
function KeyActions({ connection, isRemoving, isMakingDefault, onReplace, onRemove, onMakeDefault }: KeyActionsProps) {
  const canMakeDefault = connection.state === 'connected'
  return (
    <span className="flex gap-3">
      {canMakeDefault && (
        <button type="button" aria-label={`Use ${connection.name} by default`} onClick={onMakeDefault} disabled={isMakingDefault} className={textButtonClassNames}>
          {isMakingDefault ? 'Saving…' : 'Use by default'}
        </button>
      )}
      {connection.usesApiKey && (
        <>
          <button type="button" aria-label={`Replace key ${connection.name}`} onClick={onReplace} className={textButtonClassNames}>
            Replace key
          </button>
          <button type="button" aria-label={`Remove key ${connection.name}`} onClick={onRemove} disabled={isRemoving} className={textButtonClassNames}>
            {isRemoving ? 'Removing…' : 'Remove'}
          </button>
        </>
      )}
    </span>
  )
}

interface ModelProvidersSectionProps {
  connections: ModelConnection[] | null
  loadError: Error | null
  /** Reloads provider statuses after a key changed. */
  onKeysChanged: () => Promise<void>
}

/**
 * "AI models" on screen 21, backed by the keychain commands: Add key / Replace key open
 * an inline form that calls `setApiKey`; Remove calls `deleteApiKey`.
 */
export function ModelProvidersSection({ connections, loadError, onKeysChanged }: ModelProvidersSectionProps) {
  const [editingProvider, setEditingProvider] = useState<ModelProvider | null>(null)
  const [removingProvider, setRemovingProvider] = useState<ModelProvider | null>(null)
  const [removeErrorMessage, setRemoveErrorMessage] = useState<string | null>(null)
  const [defaultingProvider, setDefaultingProvider] = useState<ModelProvider | null>(null)

  /** New agents use this provider's recommended model from now on. */
  async function makeDefault(connection: ModelConnection) {
    setDefaultingProvider(connection.provider)
    setRemoveErrorMessage(null)
    try {
      await setDefaultModel(recommendedModelFor(connection.provider))
      await onKeysChanged()
    } catch (defaultError) {
      setRemoveErrorMessage(`Could not make ${connection.name} the default: ${describeError(defaultError)}`)
    } finally {
      setDefaultingProvider(null)
    }
  }

  async function saveKey(provider: ModelProvider, apiKey: string) {
    await setApiKey(provider, apiKey)
    await onKeysChanged()
    setEditingProvider(null)
  }

  async function removeKey(connection: ModelConnection) {
    setRemovingProvider(connection.provider)
    setRemoveErrorMessage(null)
    try {
      await deleteApiKey(connection.provider)
      await onKeysChanged()
    } catch (removeError) {
      setRemoveErrorMessage(`Could not remove the ${connection.name} key: ${describeError(removeError)}`)
    } finally {
      setRemovingProvider(null)
    }
  }

  function renderCard(connection: ModelConnection) {
    if (editingProvider === connection.provider) {
      return (
        <ProviderKeyForm
          key={connection.id}
          providerName={connection.name}
          isReplacing={connection.state !== 'available'}
          onSave={(apiKey) => saveKey(connection.provider, apiKey)}
          onCancel={() => setEditingProvider(null)}
        />
      )
    }
    const hasStoredKey = connection.usesApiKey && connection.state !== 'available'
    const hasActions = hasStoredKey || connection.state === 'connected'
    const footer = hasActions ? (
      <KeyActions
        connection={connection}
        isRemoving={removingProvider === connection.provider}
        isMakingDefault={defaultingProvider === connection.provider}
        onReplace={() => setEditingProvider(connection.provider)}
        onRemove={() => void removeKey(connection)}
        onMakeDefault={() => void makeDefault(connection)}
      />
    ) : undefined
    return <ConnectionCard key={connection.id} connection={connection} onSetUp={() => setEditingProvider(connection.provider)} footer={footer} />
  }

  return (
    <section aria-labelledby="connections-models-h" className="flex flex-col gap-2.5">
      <h2 id="connections-models-h" className={sectionHeadingClassNames}>
        {connectionCategoryTitles.models}
      </h2>
      {loadError && <p className="m-0 text-muted">Could not load AI models: {describeError(loadError)}</p>}
      {!loadError && !connections && <p className="m-0 text-muted">Loading AI models…</p>}
      {connections && <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">{connections.map(renderCard)}</div>}
      {removeErrorMessage && (
        <p aria-live="polite" className="m-0 text-[13px] text-danger">
          {removeErrorMessage}
        </p>
      )}
    </section>
  )
}
