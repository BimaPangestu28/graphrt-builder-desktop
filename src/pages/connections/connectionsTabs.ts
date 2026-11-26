import type { McpServerDefinition, WorkflowSecretOverview } from '@/api/connectionTypes'
import type { Connection } from '@/api/appConnectionTypes'
import type { DeployAccount } from '@/api/deployTypes'
import { connectionsTabPath, legacyConnectionsPluginsSection, routePaths, type ConnectionsTab } from '@/routes'
import { isSecretMissing } from './secretDisplay'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** The small status after a tab label, e.g. "2 connected" or "1 missing" (amber). */
export interface ConnectionsTabBadge {
  text: string
  isWarning: boolean
}

export interface ConnectionsTabItem {
  tab: ConnectionsTab
  label: string
  /** Null while loading, or when there is nothing worth saying (no secrets yet). */
  badge: ConnectionsTabBadge | null
}

/** What the page has loaded; each is null while loading or after a load error. */
export interface ConnectionsTabSources {
  modelConnections: Connection[] | null
  secrets: WorkflowSecretOverview[] | null
  mcpServers: McpServerDefinition[] | null
  appConnections: Connection[] | null
  /** Online accounts (Put it online); null while loading. */
  deployAccounts?: DeployAccount[] | null
}

const tabLabels: Readonly<Record<ConnectionsTab, string>> = localizedRecord(() => messages().connections.tabLabels)
const tabOrder: ConnectionsTab[] = ['models', 'secrets', 'mcp', 'online', 'apps']

function isConnectedState(connection: Connection): boolean {
  return connection.state === 'connected' || connection.state === 'default'
}

function describeModelsBadge(modelConnections: Connection[]): ConnectionsTabBadge {
  const connectedCount = modelConnections.filter(isConnectedState).length
  return connectedCount > 0 ? { text: messages().connections.connectedcountConnected(connectedCount), isWarning: false } : { text: messages().connections.noneConnected, isWarning: true }
}

function describeSecretsBadge(secrets: WorkflowSecretOverview[]): ConnectionsTabBadge | null {
  const missingCount = secrets.filter(isSecretMissing).length
  if (missingCount > 0) return { text: messages().connections.missingcountMissing(missingCount), isWarning: true }
  const savedCount = secrets.filter((secret) => secret.configured).length
  return savedCount > 0 ? { text: messages().connections.savedcountSaved(savedCount), isWarning: false } : null
}

function describeMcpBadge(mcpServers: McpServerDefinition[]): ConnectionsTabBadge | null {
  return mcpServers.length > 0 ? { text: messages().connections.valueAdded(mcpServers.length), isWarning: false } : null
}

function describeAppsBadge(appConnections: Connection[]): ConnectionsTabBadge | null {
  const signedOutCount = appConnections.filter((connection) => connection.state === 'signedOut').length
  if (signedOutCount > 0) return { text: messages().connections.signedoutcountSignedOut(signedOutCount), isWarning: true }
  const connectedCount = appConnections.filter(isConnectedState).length
  return connectedCount > 0 ? { text: messages().connections.connectedcountConnected(connectedCount), isWarning: false } : null
}

function describeOnlineBadge(accounts: DeployAccount[]): ConnectionsTabBadge | null {
  const connectedCount = accounts.filter((account) => account.connected).length
  return connectedCount > 0 ? { text: messages().connections.connectedcountConnected(connectedCount), isWarning: false } : null
}

function describeTabBadge(tab: ConnectionsTab, sources: ConnectionsTabSources): ConnectionsTabBadge | null {
  switch (tab) {
    case 'models':
      return sources.modelConnections && describeModelsBadge(sources.modelConnections)
    case 'secrets':
      return sources.secrets && describeSecretsBadge(sources.secrets)
    case 'mcp':
      return sources.mcpServers && describeMcpBadge(sources.mcpServers)
    case 'online':
      return sources.deployAccounts ? describeOnlineBadge(sources.deployAccounts) : null
    case 'apps':
      return sources.appConnections && describeAppsBadge(sources.appConnections)
  }
}

/**
 * Whether the tab is shown: Apps only when there are app accounts (the browser preview).
 *
 * @param tab - The tab (ConnectionsTab)
 * @param appConnections - Loaded app accounts, null while loading (Connection[] | null)
 * @returns True when the tab belongs in the tab bar (boolean)
 */
export function isConnectionsTabShown(tab: ConnectionsTab, appConnections: Connection[] | null): boolean {
  return tab !== 'apps' || (appConnections?.length ?? 0) > 0
}

/**
 * The tabs of the Connections page, in order, each with its badge.
 *
 * @param sources - What the page loaded (ConnectionsTabSources)
 * @returns One item per shown tab (ConnectionsTabItem[])
 *
 * @example
 * buildConnectionsTabs({ modelConnections, secrets, mcpServers: [], appConnections: [] })
 * // [{ tab: 'models', label: 'AI models', badge: { text: '2 connected', isWarning: false } }, ...]
 */
export function buildConnectionsTabs(sources: ConnectionsTabSources): ConnectionsTabItem[] {
  return tabOrder
    .filter((tab) => isConnectionsTabShown(tab, sources.appConnections))
    .map((tab) => ({ tab, label: tabLabels[tab], badge: describeTabBadge(tab, sources) }))
}

/** Narrows a `:connectionsTab` route param to a known tab. */
export function isConnectionsTab(value: string | undefined): value is ConnectionsTab {
  return tabOrder.some((tab) => tab === value)
}

/**
 * Where `/connections` sends the user: old `?section=` links keep working (plugins moved to
 * their own page; secrets and MCP open their tab with its add form, as they used to), and
 * anything else opens AI models.
 *
 * @param legacySection - The `?section=` value, if any (string | null)
 * @returns The path to redirect to (string)
 */
export function resolveConnectionsRootPath(legacySection: string | null): string {
  if (legacySection === legacyConnectionsPluginsSection) return routePaths.plugins
  if (legacySection === 'secrets' || legacySection === 'mcp') return connectionsTabPath(legacySection, { opensAddForm: true })
  return connectionsTabPath('models')
}
