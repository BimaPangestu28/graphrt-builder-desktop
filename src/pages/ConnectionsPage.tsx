import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { getCredentialStoreName } from '@/lib/platform'
import { listAppConnections } from '@/api/appConnections'
import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { listAllWorkflowSecrets } from '@/api/credentials'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { StrokeIcon } from '@/components/ui'
import { advancedConnections, connectionCategoryTitles, type Connection, type ConnectionCategory } from '@/data/connections'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { legacyConnectionsPluginsSection, routePaths } from '@/routes'
import { AdvancedSection } from './connections/AdvancedSection'
import { ConnectionCard } from './connections/ConnectionCard'
import { buildModelConnections } from './connections/modelConnections'
import { ModelProvidersSection } from './connections/ModelProvidersSection'
import { describeSecretUsers } from './connections/secretDisplay'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'

function matchesSearch(searchQuery: string, ...searchableTexts: string[]): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  if (!normalizedQuery) return true
  return searchableTexts.some((text) => text.toLowerCase().includes(normalizedQuery))
}

function ConnectionSection({ category, connections, onSetUp }: { category: ConnectionCategory; connections: Connection[]; onSetUp: (connectionId: string) => void }) {
  const headingId = `connections-${category}-h`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h2 id={headingId} className={sectionHeadingClassNames}>
        {connectionCategoryTitles[category]}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
        {connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} onSetUp={onSetUp} />
        ))}
      </div>
    </section>
  )
}

function matchesConnection(searchQuery: string, connection: Connection): boolean {
  return matchesSearch(searchQuery, connection.name, connection.connectedDescription, connection.availableDescription)
}

function matchesSecret(searchQuery: string, secret: WorkflowSecretOverview): boolean {
  return matchesSearch(searchQuery, secret.name, secret.description ?? '', secret.note ?? '', describeSecretUsers(secret), 'secret')
}

/**
 * Screen 21 · Connections.
 * Apps, AI models and keys the agents use. Search filters every section.
 * Apps come from `listAppConnections` (none in the desktop app, where apps connect through
 * plugins; the preview's sample apps include a signed-out Gmail banner). AI models come from
 * `listProviderStatuses`; their keys are added, replaced and removed through the keychain
 * commands. Advanced lists every workflow secret (`listAllWorkflowSecrets`) and MCP servers,
 * and links to the Plugins page. The old plugins address (`?section=plugins`) redirects there.
 */
export function ConnectionsPage() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('section') === legacyConnectionsPluginsSection) return <Navigate to={routePaths.plugins} replace />
  return <ConnectionsScreen />
}

function ConnectionsScreen() {
  const appConnectionsState = useAsyncData(listAppConnections, [])
  const [reconnectedAppIds, setReconnectedAppIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const providerSetupState = useProviderStatuses()
  const providerSetup = providerSetupState.data
  const secretsLoadState = useAsyncData(listAllWorkflowSecrets, [])
  const connections = (appConnectionsState.data ?? []).map((connection): Connection =>
    reconnectedAppIds.includes(connection.id) ? { ...connection, state: 'connected' } : connection,
  )

  const modelConnections = providerSetup ? buildModelConnections(providerSetup.statuses, providerSetup.defaultModel) : null
  const visibleModelConnections = modelConnections?.filter((connection) => matchesConnection(searchQuery, connection)) ?? null
  const isSearching = searchQuery.trim().length > 0
  const showsModelSection = visibleModelConnections ? visibleModelConnections.length > 0 : !isSearching
  const signedOutConnections = connections.filter((connection) => connection.state === 'signedOut')
  const visibleConnections = connections.filter((connection) => matchesConnection(searchQuery, connection))
  const visibleAdvancedRows = advancedConnections.filter((row) => matchesSearch(searchQuery, row.name, row.description))
  const visibleSecrets = secretsLoadState.data?.filter((secret) => matchesSecret(searchQuery, secret)) ?? null
  const categories: ConnectionCategory[] = ['apps']
  const hasNoAdvancedMatches = visibleAdvancedRows.length === 0 && (visibleSecrets?.length ?? 0) === 0
  const showsAdvancedSection = !isSearching || !hasNoAdvancedMatches
  const hasNoMatches = visibleConnections.length === 0 && hasNoAdvancedMatches && !showsModelSection

  function markConnected(connectionId: string) {
    setReconnectedAppIds((previousIds) => [...previousIds, connectionId])
  }

  return (
    <AppShell activeNav="connections">
      <PageFrame>
        <PageTitleBlock
          title="Connections"
          subtitle={`Apps, AI models and keys your agents use. Secrets stay in ${getCredentialStoreName()}`}
          actions={
            <label className="box-border flex h-10 w-[260px] max-w-full items-center gap-2 rounded-[10px] border border-line-strong px-3 focus-within:border-ink">
              <StrokeIcon size={15} className="text-muted">
                <circle cx="11" cy="11" r="6" />
                <path d="m20 20-4.5-4.5" />
              </StrokeIcon>
              <input
                type="search"
                aria-label="Search connections"
                placeholder="Search connections"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
              />
            </label>
          }
        />

        {signedOutConnections.map((connection) => (
          <div key={connection.id} role="alert" className="flex items-center gap-3.5 rounded-xl border border-danger-line bg-danger-tint px-4 py-3.5">
            <span className="flex-auto leading-normal">
              <b className="font-semibold">{connection.name} needs you to sign in again.</b>{' '}
              <span className="text-danger-deep">{connection.connectedDescription.replace('Used by ', '')} is paused until then</span>
            </span>
            <button
              type="button"
              onClick={() => markConnected(connection.id)}
              className="h-9 cursor-pointer whitespace-nowrap rounded-[9px] border-0 bg-ink px-3.5 text-[13px] font-semibold text-white hover:bg-ink-2"
            >
              Reconnect {connection.name}
            </button>
          </div>
        ))}

        {categories.map((category) => {
          const categoryConnections = visibleConnections.filter((connection) => connection.category === category)
          if (categoryConnections.length === 0) return null
          return <ConnectionSection key={category} category={category} connections={categoryConnections} onSetUp={markConnected} />
        })}

        {showsModelSection && (
          <ModelProvidersSection connections={visibleModelConnections} loadError={providerSetupState.error} onKeysChanged={providerSetupState.reload} />
        )}

        {showsAdvancedSection && (
          <AdvancedSection
            rows={visibleAdvancedRows}
            secretsState={{ allSecrets: secretsLoadState.data, visibleSecrets, loadError: secretsLoadState.error, isSearching, reload: secretsLoadState.reload }}
          />
        )}

        {hasNoMatches && <p className="m-0 text-muted">No connections match “{searchQuery.trim()}”</p>}
      </PageFrame>
    </AppShell>
  )
}
