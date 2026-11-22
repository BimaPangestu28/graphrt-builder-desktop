import { useState } from 'react'
import { deleteApiKey, setApiKey, setDefaultModel } from '@/api/credentials'
import type { ModelChoice, ModelProvider } from '@/api/types'
import { Button } from '@/components/ui'
import { connectionCategoryTitles } from '@/data/connections'
import { isLocalCliProvider, primaryLocalCliProviders } from '@/data/settings'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { describeError } from '@/lib/agentDisplay'
import { getCredentialStoreName } from '@/lib/platform'
import { recommendedModelFor } from '@/lib/modelChoices'
import { ConnectionCard } from './ConnectionCard'
import { ConnectionsNotice, ConnectionsSection } from './ConnectionsSection'
import { LocalCliCard } from './LocalCliCard'
import { MoreLocalCliSection } from './MoreLocalCliSection'
import type { ModelConnection } from './modelConnections'
import { ProviderKeyForm } from './ProviderKeyForm'

/** Same column rule as the Apps grid, so cards line up across tabs. */
export const connectionCardGridClassNames = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3'

interface KeyActionsProps {
  connection: ModelConnection
  isRemoving: boolean
  isMakingDefault: boolean
  onReplace: () => void
  onRemove: () => void
  onMakeDefault: () => void
}

/**
 * Buttons at the bottom of a connected provider card: "Use by default" when it is not the
 * default model's provider, "Replace key", and "Remove" pushed to the right, when it has a
 * key in the keychain. The default card's badge already says it is the default.
 */
function KeyActions({ connection, isRemoving, isMakingDefault, onReplace, onRemove, onMakeDefault }: KeyActionsProps) {
  const canMakeDefault = connection.state === 'connected'
  return (
    <>
      {canMakeDefault && (
        <Button size="sm" variant="secondary" aria-label={`Use ${connection.name} by default`} onClick={onMakeDefault} disabled={isMakingDefault}>
          {isMakingDefault ? 'Saving…' : 'Use by default'}
        </Button>
      )}
      {connection.usesApiKey && (
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label={`Replace key ${connection.name}`} onClick={onReplace}>
            Replace key
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove key ${connection.name}`} onClick={onRemove} disabled={isRemoving} className="!text-danger hover:!bg-danger-tint">
            {isRemoving ? 'Removing…' : 'Remove'}
          </Button>
        </span>
      )}
    </>
  )
}

interface ModelProvidersSectionProps {
  connections: ModelConnection[] | null
  /** The stored default model, null while loading. */
  defaultModel: ModelChoice | null
  loadError: Error | null
  /** Reloads provider statuses after a key changed. */
  onKeysChanged: () => Promise<void>
}

/**
 * The AI models tab of screen 21: one card per provider, the default one highlighted, backed by the keychain commands: Add key / Replace key open
 * an inline form that calls `setApiKey`; Remove calls `deleteApiKey`. Below them, the
 * Experimental local CLIs (Claude Code, Codex on this computer) get their own cards, and
 * the other CLIs follow under "More AI tools on this computer" (found ones first, the
 * rest collapsed under "Other AI tools you can use").
 */
export function ModelProvidersSection({ connections, defaultModel, loadError, onKeysChanged }: ModelProvidersSectionProps) {
  const availableModelsState = useAvailableModels()
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

  /** After a CLI was turned on or off: statuses, the default and its model list may all change. */
  async function reloadAfterLocalCliChange() {
    await onKeysChanged()
    await availableModelsState.reload()
  }

  function renderLocalCliCard(connection: ModelConnection) {
    if (!isLocalCliProvider(connection.provider) || !connection.localCli || !defaultModel) return null
    const providerModels = availableModelsState.data?.find((list) => list.provider === connection.provider)?.models ?? null
    return (
      <LocalCliCard
        key={connection.id}
        connection={connection}
        provider={connection.provider}
        localCli={connection.localCli}
        defaultModel={defaultModel}
        models={providerModels}
        onChanged={reloadAfterLocalCliChange}
      />
    )
  }

  const keyedConnections = connections?.filter((connection) => !isLocalCliProvider(connection.provider)) ?? []
  const isPrimaryLocalCli = (connection: ModelConnection) => (primaryLocalCliProviders as readonly string[]).includes(connection.provider)
  const localCliConnections = connections?.filter((connection) => isLocalCliProvider(connection.provider) && isPrimaryLocalCli(connection)) ?? []
  const moreLocalCliConnections = connections?.filter((connection) => isLocalCliProvider(connection.provider) && !isPrimaryLocalCli(connection)) ?? []

  return (
    <ConnectionsSection
      id="connections-models"
      title={connectionCategoryTitles.models}
      description={`The models your agents think with: an API key, a local model with Ollama, or an AI tool already signed in on this computer (Claude Code, Codex, Gemini CLI and more). Keys stay in ${getCredentialStoreName()}; new agents use the default`}
    >
      {loadError && <ConnectionsNotice tone="danger">Could not load AI models: {describeError(loadError)}</ConnectionsNotice>}
      {!loadError && !connections && <ConnectionsNotice>Loading AI models…</ConnectionsNotice>}
      {connections && <div className={connectionCardGridClassNames}>{keyedConnections.map(renderCard)}</div>}
      {localCliConnections.length > 0 && (
        <div role="group" aria-labelledby="connections-local-cli-h" className="flex min-w-0 flex-col gap-3 pt-2">
          <div className="flex flex-col gap-0.5">
            <h3 id="connections-local-cli-h" className="m-0 text-[14px] font-semibold">
              Already signed in on this computer
            </h3>
            <p className="m-0 text-[13px] leading-normal text-muted">
              Experimental: graphrt can think with your own Claude Code or Codex. Each stays off until you turn it on
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3">{localCliConnections.map(renderLocalCliCard)}</div>
        </div>
      )}
      <MoreLocalCliSection connections={moreLocalCliConnections} renderCard={renderLocalCliCard} />
      {removeErrorMessage && (
        <p aria-live="polite" className="m-0 text-[13px] text-danger">
          {removeErrorMessage}
        </p>
      )}
    </ConnectionsSection>
  )
}
