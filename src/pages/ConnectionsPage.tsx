import { useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { listAppConnections } from '@/api/appConnections'
import { listAllWorkflowSecrets } from '@/api/credentials'
import { listDeployAccounts } from '@/api/deploy'
import { listMcpServers } from '@/api/mcpServers'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Button, Icon } from '@/components/ui'
import type { Connection } from '@/api/appConnectionTypes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { getCredentialStoreName } from '@/lib/platform'
import { connectionsTabPath, type ConnectionsTab } from '@/routes'
import { AppConnectionsSection } from './connections/AppConnectionsSection'
import { ConnectionsTabBar } from './connections/ConnectionsTabBar'
import { buildConnectionsTabs, isConnectionsTab, isConnectionsTabShown, resolveConnectionsRootPath } from './connections/connectionsTabs'
import { McpServersSection } from './connections/McpServersSection'
import { buildModelConnections } from './connections/modelConnections'
import { ModelProvidersSection } from './connections/ModelProvidersSection'
import { SecretsSection } from './connections/SecretsSection'
import { OnlineAccountsSection } from './deploy/OnlineAccountsSection'
import { messages } from '@/i18n'

/**
 * `/connections`: redirects to a tab. Old `?section=` links still land in the right place
 * (`plugins` → the Plugins page, `secrets` / `mcp` → that tab with its add form open).
 */
export function ConnectionsPage() {
  const [searchParams] = useSearchParams()
  return <Navigate to={resolveConnectionsRootPath(searchParams.get('section'))} replace />
}

/**
 * Screen 21 · Connections, one tab per kind: AI models (`/connections/models`), Secrets
 * (`/connections/secrets`), MCP servers (`/connections/mcp`) and, in the browser preview only,
 * Apps (`/connections/apps`). Tabs are links, so they deep-link and survive a refresh; each tab
 * label carries a small status. The page loads every tab's data so those statuses stay live
 * (adding an MCP server that needs a secret updates the Secrets badge). A signed-out app
 * shows a banner above the tabs whichever tab is open.
 */
export function ConnectionsTabPage() {
  const { connectionsTab } = useParams()
  if (!isConnectionsTab(connectionsTab)) return <Navigate to={connectionsTabPath('models')} replace />
  return <ConnectionsScreen activeTab={connectionsTab} />
}

function SignedOutBanner({ connection, onReconnect }: { connection: Connection; onReconnect: (connectionId: string) => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] border border-danger-line bg-danger-tint px-4 py-3">
      <Icon name="alert" size={18} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-[1_1_280px] leading-normal">
        <b className="font-semibold">{connection.name} {messages().connections.needsYouToSignInAgain}</b>{' '}
        <span className="text-danger-deep">{connection.connectedDescription.replace('Used by ', '')} {messages().connections.isPausedUntilThen}</span>
      </span>
      <Button size="sm" onClick={() => onReconnect(connection.id)} className="ml-auto">
        {messages().connections.reconnect}{' '}{connection.name}
      </Button>
    </div>
  )
}

/** App accounts with the ones reconnected on this visit marked connected. */
function useAppConnections() {
  const appConnectionsState = useAsyncData(listAppConnections, [])
  const [reconnectedAppIds, setReconnectedAppIds] = useState<string[]>([])
  const appConnections =
    appConnectionsState.data?.map((connection): Connection => (reconnectedAppIds.includes(connection.id) ? { ...connection, state: 'connected' } : connection)) ?? null
  const markConnected = (connectionId: string) => setReconnectedAppIds((previousIds) => [...previousIds, connectionId])
  return { appConnections, markConnected }
}

function ConnectionsScreen({ activeTab }: { activeTab: ConnectionsTab }) {
  const { appConnections, markConnected } = useAppConnections()
  const providerSetupState = useProviderStatuses()
  const providerSetup = providerSetupState.data
  const secretsState = useAsyncData(listAllWorkflowSecrets, [])
  const mcpServersState = useAsyncData(listMcpServers, [])
  const deployAccountsState = useAsyncData(listDeployAccounts, [])
  const modelConnections = providerSetup ? buildModelConnections(providerSetup.statuses, providerSetup.defaultModel) : null
  const tabs = buildConnectionsTabs({ modelConnections, secrets: secretsState.data, mcpServers: mcpServersState.data, appConnections, deployAccounts: deployAccountsState.data })
  const signedOutConnections = appConnections?.filter((connection) => connection.state === 'signedOut') ?? []

  if (appConnections && !isConnectionsTabShown(activeTab, appConnections)) return <Navigate to={connectionsTabPath('models')} replace />

  return (
    <AppShell activeNav="connections">
      <PageFrame className="gap-6">
        <PageTitleBlock title={messages().connections.connections} subtitle={messages().connections.aiModelsSecretsToolsAndThe(getCredentialStoreName())} />
        {signedOutConnections.map((connection) => (
          <SignedOutBanner key={connection.id} connection={connection} onReconnect={markConnected} />
        ))}
        <div className="flex min-w-0 flex-col gap-4">
          <ConnectionsTabBar tabs={tabs} activeTab={activeTab} />
          {activeTab === 'models' && <ModelProvidersSection connections={modelConnections} defaultModel={providerSetup?.defaultModel ?? null} loadError={providerSetupState.error} onKeysChanged={providerSetupState.reload} />}
          {activeTab === 'secrets' && <SecretsSection secretsState={{ secrets: secretsState.data, loadError: secretsState.error, reload: secretsState.reload }} />}
          {activeTab === 'mcp' && <McpServersSection servers={mcpServersState} onServersChanged={secretsState.reload} />}
          {activeTab === 'online' && <OnlineAccountsSection onAccountsChanged={() => void deployAccountsState.reload()} />}
          {activeTab === 'apps' && appConnections && <AppConnectionsSection connections={appConnections} onSetUp={markConnected} />}
        </div>
      </PageFrame>
    </AppShell>
  )
}
