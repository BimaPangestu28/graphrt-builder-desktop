import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import type { McpServerDefinition, WorkflowSecretOverview } from '@/api/connectionTypes'
import type { LocalCliStatus } from '@/api/types'
import { connectionsTabPattern } from '@/routes'
import { ConnectionsTabPage } from '../ConnectionsPage'

/**
 * The Connections screen inside the desktop app shows only what the backend reports:
 * no sample apps, no invented "Connected" rows.
 */

let workflowSecrets: WorkflowSecretOverview[] = []
let mcpServers: McpServerDefinition[] = []
/**
 * No model connected yet, as the backend reports it: no key, Claude Code installed but off,
 * no default model. Ollama needs no key, so it always counts as configured.
 */
let noModelYet = false
/** A real failure reading the default model (not "none connected yet"). */
let defaultModelFailure: BackendError | null = null

const claudeCodeTurnedOff: LocalCliStatus = {
  enabled: false,
  installed: true,
  version: '2.1.330 (Claude Code)',
  problem: null,
  path: '/usr/local/bin/claude',
  signIn: 'signed_in',
  installUrl: 'https://example.com/install',
}

function answerBackend(command: string): unknown {
  switch (command) {
    case 'list_all_workflow_secrets':
      return workflowSecrets
    case 'list_mcp_servers':
      return mcpServers
    case 'list_provider_statuses':
      return noModelYet
        ? [
            { provider: 'openai', configured: false },
            { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' },
            { provider: 'claude-code-cli', configured: false, localCli: claudeCodeTurnedOff },
          ]
        : [{ provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' }]
    case 'get_default_model':
      if (defaultModelFailure) throw defaultModelFailure
      if (noModelYet) throw new BackendError('missing_credentials', 'not set up yet: an AI model')
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

function renderConnectionsPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={connectionsTabPattern} element={<ConnectionsTabPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function getTabBar() {
  return screen.getByRole('navigation', { name: 'Connections sections' })
}

function secretOverview(name: string): WorkflowSecretOverview {
  return { name, description: null, isSecret: true, required: true, configured: false, agents: [], mcpServers: [], note: null, createdAt: null, updatedAt: null }
}

function getSecretsSection() {
  return screen.getByRole('region', { name: 'Secrets' })
}

describe('ConnectionsPage in the desktop app', () => {
  beforeEach(() => {
    workflowSecrets = []
    mcpServers = []
    noModelYet = false
    defaultModelFailure = null
  })

  it('explains how to connect a model instead of showing an error when none is connected yet', async () => {
    noModelYet = true
    renderConnectionsPage('/connections/models')
    expect(await screen.findByRole('heading', { name: 'Connect an AI model to get started' })).toBeInTheDocument()
    expect(screen.queryByText(/Could not load AI models/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not set up yet/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect a model' })).toBeInTheDocument()
    expect(await screen.findByText('OpenAI')).toBeInTheDocument()
    // The AI app already on this computer stays offered: it is the easiest one to connect.
    expect(screen.getByRole('button', { name: 'Turn on Claude Code' })).toBeInTheDocument()
  })

  it('still reports a real failure to read the default model as an error', async () => {
    defaultModelFailure = new BackendError('credentials', 'the key store is locked')
    renderConnectionsPage('/connections/models')
    expect(await screen.findByText('Could not load AI models: the key store is locked')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connect an AI model to get started' })).not.toBeInTheDocument()
  })

  it('shows no sample apps, no Apps tab and honest empty states', async () => {
    renderConnectionsPage('/connections/secrets')
    expect(await within(getSecretsSection()).findByText(/No secrets yet\. Use Add secret, or add an agent that needs one and it appears here/)).toBeInTheDocument()
    expect(await within(getTabBar()).findByRole('link', { name: 'AI models 1 connected' })).toBeInTheDocument()
    expect(within(getTabBar()).getByRole('link', { name: 'Secrets' })).toHaveAttribute('aria-current', 'page')
    expect(within(getTabBar()).getByRole('link', { name: 'MCP servers' })).toBeInTheDocument()
    expect(within(getTabBar()).queryByRole('link', { name: /^Apps/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add secret' }))
    expect(screen.getByRole('form', { name: 'Add a secret' })).toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByText(/Google Places/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says there are no MCP servers yet', async () => {
    renderConnectionsPage('/connections/mcp')
    const mcpSection = screen.getByRole('region', { name: 'MCP servers' })
    expect(await within(mcpSection).findByText(/No MCP servers yet/)).toBeInTheDocument()
  })

  it('sends the Apps tab to AI models, since the desktop app has no app accounts', async () => {
    renderConnectionsPage('/connections/apps')
    expect(await screen.findByRole('region', { name: 'AI models' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Apps' })).not.toBeInTheDocument()
  })

  it('lists the secrets the agents declare, set or not', async () => {
    workflowSecrets = [
      { ...secretOverview('GITHUB_TOKEN'), mcpServers: ['github'] },
      { ...secretOverview('MAPS_API_KEY'), configured: true, agents: [{ agentId: 'a1', agentName: '[AGENT NAME]' }] },
    ]
    renderConnectionsPage('/connections/secrets')
    expect(await within(getTabBar()).findByRole('link', { name: 'Secrets 1 missing' })).toBeInTheDocument()
    const githubRow = within(getSecretsSection()).getByRole('listitem', { name: 'GITHUB_TOKEN' })
    expect(within(githubRow).getByText('Used by MCP server github')).toBeInTheDocument()
    expect(within(githubRow).getByText('Missing')).toBeInTheDocument()
    expect(within(githubRow).getByRole('button', { name: 'Add GITHUB_TOKEN' })).toHaveTextContent('Add value')
    expect(within(getSecretsSection()).getByText('Used by [AGENT NAME]')).toBeInTheDocument()
    expect(within(getSecretsSection()).getByRole('button', { name: 'Remove MAPS_API_KEY' })).toBeInTheDocument()
  })
})
