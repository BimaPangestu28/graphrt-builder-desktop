import { useState } from 'react'
import { deleteApiKey, setApiKey, setDefaultModel } from '@/api/credentials'
import type { ModelChoice, ModelProvider } from '@/api/types'
import { Button } from '@/components/ui'
import { connectionCategoryTitles } from '@/pages/connections/modelCardTemplates'
import { isLocalCliProvider, primaryLocalCliProviders } from '@/lib/settings'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { describeError } from '@/lib/agentDisplay'
import { getCredentialStoreName } from '@/lib/platform'
import { recommendedModelFor } from '@/lib/modelChoices'
import { ConnectionCard } from './ConnectionCard'
import { ConnectionsNotice, ConnectionsSection } from './ConnectionsSection'
import { LocalCliCard } from './LocalCliCard'
import { MoreLocalCliSection } from './MoreLocalCliSection'
import { countConnectedModels, type ModelConnection } from './modelConnections'
import { OllamaCard } from './OllamaCard'
import { ProviderKeyForm } from './ProviderKeyForm'
import { messages } from '@/i18n'

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
        <Button size="sm" variant="secondary" aria-label={messages().connections.useNameByDefault(connection.name)} onClick={onMakeDefault} disabled={isMakingDefault}>
          {isMakingDefault ? messages().connections.saving : messages().connections.useByDefault}
        </Button>
      )}
      {connection.usesApiKey && (
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label={messages().connections.replaceKeyName(connection.name)} onClick={onReplace}>
            {messages().connections.replaceKey}
          </Button>
          <Button size="sm" variant="ghost" aria-label={messages().connections.removeKeyName(connection.name)} onClick={onRemove} disabled={isRemoving} className="!text-danger hover:!bg-danger-tint">
            {isRemoving ? messages().connections.removing : messages().connections.remove}
          </Button>
        </span>
      )}
    </>
  )
}

/** Where "Connect a model" takes you: an AI app already on this computer first, else the key cards. */
const recommendedTargetIds = { localCli: 'connections-local-cli', keyedCards: 'connections-model-cards' } as const

/** Shown instead of an error while no model is connected: what a model is for and where to connect one. */
function NoModelYet({ hasLocalCli }: { hasLocalCli: boolean }) {
  const showChoices = () => {
    const target = document.getElementById(hasLocalCli ? recommendedTargetIds.localCli : recommendedTargetIds.keyedCards)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
  }
  return (
    <div role="region" aria-labelledby="connections-no-model-h" className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-5">
      <h3 id="connections-no-model-h" className="m-0 text-[15px] font-semibold">
        {messages().connections.noModelYetTitle}
      </h3>
      <p className="m-0 max-w-[640px] text-[13px] leading-normal text-muted">{messages().connections.noModelYetBody}</p>
      <Button onClick={showChoices}>{messages().connections.connectAModel}</Button>
    </div>
  )
}

interface ModelProvidersSectionProps {
  connections: ModelConnection[] | null
  /** The stored default model; null while loading and while no model is connected yet. */
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
      setRemoveErrorMessage(messages().connections.couldNotMakeNameTheDefault(connection.name, describeError(defaultError)))
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
      setRemoveErrorMessage(messages().connections.couldNotRemoveTheNameKey(connection.name, describeError(removeError)))
    } finally {
      setRemovingProvider(null)
    }
  }

  function renderCard(connection: ModelConnection) {
    if (connection.provider === 'ollama') return <OllamaCard key={connection.id} connection={connection} defaultModel={defaultModel} onChanged={onKeysChanged} />
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
    if (!isLocalCliProvider(connection.provider) || !connection.localCli) return null
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
      description={messages().connections.theModelsYourAgentsThinkWith(getCredentialStoreName())}
    >
      {loadError && <ConnectionsNotice tone="danger">{messages().connections.couldNotLoadAiModels}{' '}{describeError(loadError)}</ConnectionsNotice>}
      {!loadError && !connections && <ConnectionsNotice>{messages().connections.loadingAiModels}</ConnectionsNotice>}
      {connections && countConnectedModels(connections) === 0 && <NoModelYet hasLocalCli={localCliConnections.some((connection) => connection.localCli?.installed)} />}
      {connections && (
        <div id={recommendedTargetIds.keyedCards} className={connectionCardGridClassNames}>
          {keyedConnections.map(renderCard)}
        </div>
      )}
      {localCliConnections.length > 0 && (
        <div id={recommendedTargetIds.localCli} role="group" aria-labelledby="connections-local-cli-h" className="flex min-w-0 flex-col gap-3 pt-2">
          <div className="flex flex-col gap-0.5">
            <h3 id="connections-local-cli-h" className="m-0 text-[14px] font-semibold">
              {messages().connections.alreadySignedInOnThisComputer}
            </h3>
            <p className="m-0 text-[13px] leading-normal text-muted">
              {messages().connections.experimentalGraphrtCanThinkWithYour}
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
