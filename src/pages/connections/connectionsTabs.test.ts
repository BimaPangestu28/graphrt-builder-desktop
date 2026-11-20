import type { McpServerDefinition, WorkflowSecretOverview } from '@/api/connectionTypes'
import type { Connection, ConnectionState } from '@/data/connections'
import { connectionsTabPath } from '@/routes'
import { buildConnectionsTabs, isConnectionsTab, resolveConnectionsRootPath, type ConnectionsTabSources } from './connectionsTabs'

function connection(state: ConnectionState): Connection {
  return { id: state, name: state, category: 'models', state, connectedLabel: '', connectedDescription: '', availableDescription: '', setupActionLabel: 'Add key' }
}

function secret(overrides: Partial<WorkflowSecretOverview>): WorkflowSecretOverview {
  return { name: 'API_TOKEN', description: null, isSecret: true, required: false, configured: false, agents: [], mcpServers: [], note: null, createdAt: null, updatedAt: null, ...overrides }
}

const mcpServer: McpServerDefinition = { name: 'files', transport: { kind: 'stdio', command: 'npx', args: [] }, secretEnv: [], bearerTokenSecret: null, knownTools: [], lastCheck: null }

const loadingSources: ConnectionsTabSources = { modelConnections: null, secrets: null, mcpServers: null, appConnections: null }

function badgeTexts(sources: ConnectionsTabSources): Record<string, string | null> {
  return Object.fromEntries(buildConnectionsTabs(sources).map((item) => [item.tab, item.badge ? `${item.badge.text}${item.badge.isWarning ? ' (warning)' : ''}` : null]))
}

describe('connectionsTabPath', () => {
  it('builds a tab address, optionally opening its add form', () => {
    expect(connectionsTabPath('models')).toBe('/connections/models')
    expect(connectionsTabPath('secrets', { opensAddForm: true })).toBe('/connections/secrets?add=1')
  })
})

describe('buildConnectionsTabs', () => {
  it('lists AI models, Secrets and MCP servers without badges while loading, and no Apps tab', () => {
    expect(buildConnectionsTabs(loadingSources)).toEqual([
      { tab: 'models', label: 'AI models', badge: null },
      { tab: 'secrets', label: 'Secrets', badge: null },
      { tab: 'mcp', label: 'MCP servers', badge: null },
    ])
  })

  it('counts connected models, missing or saved secrets and added servers', () => {
    const sources: ConnectionsTabSources = {
      modelConnections: [connection('default'), connection('connected'), connection('available')],
      secrets: [secret({ configured: true }), secret({ required: true })],
      mcpServers: [mcpServer],
      appConnections: [],
    }
    expect(badgeTexts(sources)).toEqual({ models: '2 connected', secrets: '1 missing (warning)', mcp: '1 added' })
    expect(badgeTexts({ ...sources, secrets: [secret({ configured: true }), secret({})] })).toMatchObject({ secrets: '1 saved' })
  })

  it('warns when no model is connected and stays quiet when there are no secrets or servers', () => {
    expect(badgeTexts({ modelConnections: [connection('available')], secrets: [], mcpServers: [], appConnections: [] })).toEqual({
      models: 'None connected (warning)',
      secrets: null,
      mcp: null,
    })
  })

  it('adds an Apps tab only when there are app accounts, warning about signed-out ones', () => {
    const appConnections = [{ ...connection('connected'), category: 'apps' as const }, { ...connection('signedOut'), category: 'apps' as const }]
    expect(badgeTexts({ ...loadingSources, appConnections })).toMatchObject({ apps: '1 signed out (warning)' })
    expect(badgeTexts({ ...loadingSources, appConnections: appConnections.slice(0, 1) })).toMatchObject({ apps: '1 connected' })
  })
})

describe('isConnectionsTab', () => {
  it('accepts only known tabs', () => {
    expect(isConnectionsTab('mcp')).toBe(true)
    expect(isConnectionsTab('plugins')).toBe(false)
    expect(isConnectionsTab(undefined)).toBe(false)
  })
})

describe('resolveConnectionsRootPath', () => {
  it('opens AI models by default and keeps old ?section= links working', () => {
    expect(resolveConnectionsRootPath(null)).toBe('/connections/models')
    expect(resolveConnectionsRootPath('advanced')).toBe('/connections/models')
    expect(resolveConnectionsRootPath('plugins')).toBe('/plugins')
    expect(resolveConnectionsRootPath('secrets')).toBe('/connections/secrets?add=1')
    expect(resolveConnectionsRootPath('mcp')).toBe('/connections/mcp?add=1')
  })
})
