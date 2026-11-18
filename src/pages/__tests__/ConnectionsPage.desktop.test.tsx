import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { McpServerDefinition, WorkflowSecretOverview } from '@/api/connectionTypes'
import { ConnectionsPage } from '../ConnectionsPage'

/**
 * The Connections screen inside the desktop app shows only what the backend reports:
 * no sample apps, no invented "Connected" rows.
 */

let workflowSecrets: WorkflowSecretOverview[] = []
let mcpServers: McpServerDefinition[] = []

function answerBackend(command: string): unknown {
  switch (command) {
    case 'list_all_workflow_secrets':
      return workflowSecrets
    case 'list_mcp_servers':
      return mcpServers
    case 'list_provider_statuses':
      return [{ provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' }]
    case 'get_default_model':
      return { provider: 'ollama', name: 'llama3.2' }
    case 'list_installed_plugins':
    case 'list_plugin_catalog':
      return []
    default:
      return null
  }
}

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return {
    ...original,
    isDesktopApp: () => true,
    callBackend: async (command: string) => answerBackend(command),
  }
})

function renderConnectionsPage() {
  return render(
    <MemoryRouter>
      <ConnectionsPage />
    </MemoryRouter>,
  )
}

function getAdvancedSection() {
  return screen.getByRole('region', { name: 'Advanced' })
}

describe('ConnectionsPage in the desktop app', () => {
  beforeEach(() => {
    workflowSecrets = []
    mcpServers = []
  })

  it('shows no sample apps and honest empty states', async () => {
    renderConnectionsPage()
    expect(await within(getAdvancedSection()).findByText(/No agent needs an API key or token yet/)).toBeInTheDocument()
    expect(await within(getAdvancedSection()).findByText('Give agents tools from any MCP server · 0 added')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByText(/Google Places/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists the secrets the agents declare, set or not', async () => {
    workflowSecrets = [
      { name: 'GITHUB_TOKEN', description: null, isSecret: true, required: true, configured: false, agents: [], mcpServers: ['github'] },
      {
        name: 'MAPS_API_KEY',
        description: null,
        isSecret: true,
        required: true,
        configured: true,
        agents: [{ agentId: 'a1', agentName: '[AGENT NAME]' }],
        mcpServers: [],
      },
    ]
    renderConnectionsPage()
    expect(await within(getAdvancedSection()).findByText('GITHUB_TOKEN')).toBeInTheDocument()
    expect(within(getAdvancedSection()).getByText('Used by MCP server github')).toBeInTheDocument()
    expect(within(getAdvancedSection()).getByText('Not set')).toBeInTheDocument()
    expect(within(getAdvancedSection()).getByText('Used by [AGENT NAME]')).toBeInTheDocument()
    expect(within(getAdvancedSection()).getByRole('button', { name: 'Add GITHUB_TOKEN' })).toBeInTheDocument()
    expect(within(getAdvancedSection()).getByRole('button', { name: 'Remove MAPS_API_KEY' })).toBeInTheDocument()
  })
})
