import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { resetSampleMcpServers, sampleMcpServersBackend } from '@/api/sampleBackend/mcpServers'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { routePaths } from '@/routes'
import { ConnectionsPage } from '../ConnectionsPage'

function renderConnectionsPage(initialPath = '/connections') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConnectionsPage />
    </MemoryRouter>,
  )
}

function getModelsSection() {
  return screen.getByRole('region', { name: 'AI models' })
}

describe('ConnectionsPage', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
    resetSampleMcpServers()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows apps, AI models and the Gmail sign-in warning', async () => {
    renderConnectionsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI models' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gmail needs you to sign in again.')
    expect(screen.getByText('Signed out')).toBeInTheDocument()
  })

  it('loads provider statuses for the AI model cards', async () => {
    renderConnectionsPage()
    expect(within(getModelsSection()).getByText('Loading AI models…')).toBeInTheDocument()
    expect(await within(getModelsSection()).findByText('Default')).toBeInTheDocument()
    expect(within(getModelsSection()).getByText('Found on this computer')).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Anthropic' })).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Google Gemini' })).toBeInTheDocument()
  })

  it('reconnects Gmail from the banner', async () => {
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Gmail' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument()
  })

  it('adds a provider key with the inline form', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add key Anthropic' }))
    const keyInput = screen.getByLabelText('Anthropic API key')
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    fireEvent.change(keyInput, { target: { value: ' sk-ant-123 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Key in Keychain · not used yet')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('anthropic', 'sk-ant-123')
    expect(screen.queryByRole('button', { name: 'Add key Anthropic' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument()
  })

  it('makes a connected provider the default model', async () => {
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    await sampleCredentialsBackend.setApiKey('deepseek', 'sk-deepseek')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Use DeepSeek by default' }))
    await waitFor(() => expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'deepseek', name: 'deepseek-chat' }))
    // DeepSeek is now the default, so its card no longer offers it; OpenAI does.
    expect(await screen.findByRole('button', { name: 'Use OpenAI by default' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use DeepSeek by default' })).not.toBeInTheDocument()
  })

  it('replaces and removes a stored key', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const deleteApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'deleteApiKey')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Replace key OpenAI' }))
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('button', { name: 'Remove key OpenAI' })).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('openai', 'sk-new')

    fireEvent.click(screen.getByRole('button', { name: 'Remove key OpenAI' }))
    expect(await screen.findByRole('button', { name: 'Add key OpenAI' })).toBeInTheDocument()
    expect(deleteApiKeySpy).toHaveBeenCalledWith('openai')
  })

  it('keeps the form open and explains a failed save', async () => {
    vi.spyOn(sampleCredentialsBackend, 'setApiKey').mockRejectedValue(new BackendError('credentials', 'Keychain access was denied'))
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add key Google Gemini' }))
    fireEvent.change(screen.getByLabelText('Google Gemini API key'), { target: { value: 'g-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Could not save the key: Keychain access was denied')).toBeInTheDocument()
    expect(screen.getByLabelText('Google Gemini API key')).toBeInTheDocument()
  })

  it('shows a quiet message when provider statuses cannot be loaded', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    renderConnectionsPage()
    expect(await screen.findByText('Could not load AI models: Keychain is locked')).toBeInTheDocument()
  })

  it('shows AI models, Secrets and MCP servers as sections, and links to the Plugins page where plugins used to be managed', async () => {
    renderConnectionsPage()
    expect(await screen.findByRole('region', { name: 'Secrets' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'MCP servers' })).toBeInTheDocument()
    const pluginsCard = screen.getByRole('complementary', { name: 'Plugins' })
    expect(within(pluginsCard).getByText('Plugins moved to their own page in the sidebar')).toBeInTheDocument()
    expect(within(pluginsCard).getByRole('link', { name: 'Open Plugins' })).toHaveAttribute('href', routePaths.plugins)
    expect(screen.queryByRole('region', { name: 'Advanced' })).not.toBeInTheDocument()
  })

  it('redirects the old plugins address to the Plugins page', async () => {
    render(
      <MemoryRouter initialEntries={['/connections?section=plugins']}>
        <Routes>
          <Route path={routePaths.connections} element={<ConnectionsPage />} />
          <Route path={routePaths.plugins} element={<h1>Plugins page</h1>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Plugins page' })).toBeInTheDocument()
  })

  it('filters connections by search', async () => {
    renderConnectionsPage()
    await within(getModelsSection()).findByText('Default')
    await screen.findByText('WhatsApp')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'ollama' } })
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'zzz' } })
    expect(screen.getByText(/No connections match/)).toBeInTheDocument()
  })
})

function getSecretsSection() {
  return screen.getByRole('region', { name: 'Secrets' })
}

describe('ConnectionsPage secrets', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleMcpServers()
  })
  afterEach(() => vi.restoreAllMocks())

  async function openSecretsPanel() {
    renderConnectionsPage()
    expect(await within(getSecretsSection()).findByText(/your agents use · 1 saved/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add secret' }))
    return getSecretsSection()
  }

  function getSecretRow(name: string) {
    return within(screen.getByRole('region', { name: 'Secrets' })).getByRole('listitem', { name })
  }

  it('lists every secret with who uses it and whether it is saved', async () => {
    const secretsPanel = await openSecretsPanel()
    expect(within(secretsPanel).getByText('Google Places API key')).toBeInTheDocument()
    expect(within(secretsPanel).getByText('GOOGLE_PLACES_API_KEY · Used by Maps leads to WhatsApp')).toBeInTheDocument()
    expect(within(secretsPanel).getByText('Saved')).toBeInTheDocument()
    expect(within(secretsPanel).queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument()
    fireEvent.click(within(secretsPanel).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
    expect(within(secretsPanel).getByText('Google Places API key')).toBeInTheDocument()
  })

  it('lists the secrets without opening anything', async () => {
    renderConnectionsPage()
    expect(await within(getSecretsSection()).findByText('Google Places API key')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
  })

  it('opens the add-secret form from ?section=secrets', async () => {
    renderConnectionsPage('/connections?section=secrets')
    expect(await screen.findByRole('form', { name: 'Add a secret' })).toBeInTheDocument()
  })

  it('adds a secret that no agent uses yet, without ever showing its value again', async () => {
    const addSecretSpy = vi.spyOn(sampleCredentialsBackend, 'addWorkflowSecret')
    await openSecretsPanel()
    const addForm = screen.getByRole('form', { name: 'Add a secret' })
    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'my server-token' } })
    expect(within(addForm).getByLabelText('Name')).toHaveValue('MY_SERVER_TOKEN')
    const valueInput = within(addForm).getByLabelText('Value')
    expect(valueInput).toHaveAttribute('type', 'password')
    fireEvent.change(valueInput, { target: { value: '[SERVER TOKEN]' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Show Value' }))
    expect(valueInput).toHaveAttribute('type', 'text')
    fireEvent.change(within(addForm).getByLabelText('Note (optional)'), { target: { value: 'Home server deploys' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Save secret' }))

    expect(await within(addForm).findByText('MY_SERVER_TOKEN is saved in macOS Keychain. Agents read it as {{#env.MY_SERVER_TOKEN#}}')).toBeInTheDocument()
    expect(addSecretSpy).toHaveBeenCalledWith({ name: 'MY_SERVER_TOKEN', value: '[SERVER TOKEN]', note: 'Home server deploys' })
    const serverTokenRow = getSecretRow('MY_SERVER_TOKEN')
    expect(within(serverTokenRow).getByText(/^Home server deploys · Not used yet · Saved Just now$/)).toBeInTheDocument()
    expect(within(serverTokenRow).getByText('Saved')).toBeInTheDocument()
    expect(within(addForm).getByLabelText('Value')).toHaveValue('')
    expect(screen.queryByText('[SERVER TOKEN]')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('[SERVER TOKEN]')).not.toBeInTheDocument()
    expect(within(getSecretsSection()).getByText(/your agents use · 2 saved/)).toBeInTheDocument()
  })

  it('explains a malformed name or an empty value before saving', async () => {
    const addSecretSpy = vi.spyOn(sampleCredentialsBackend, 'addWorkflowSecret')
    await openSecretsPanel()
    const addForm = screen.getByRole('form', { name: 'Add a secret' })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Save secret' }))
    expect(within(addForm).getByRole('alert')).toHaveTextContent('Give the secret a name, like MY_SERVER_TOKEN')

    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: '1TOKEN' } })
    expect(within(addForm).getByRole('alert')).toHaveTextContent('Start the name with a letter')
    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'API.TOKEN' } })
    expect(within(addForm).getByRole('alert')).toHaveTextContent('Use capital letters, digits and underscores')

    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'API_TOKEN' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Save secret' }))
    expect(within(addForm).getByRole('alert')).toHaveTextContent('Paste the value to save')
    expect(addSecretSpy).not.toHaveBeenCalled()
  })

  it('shows the backend refusal when the name already has a value', async () => {
    await openSecretsPanel()
    const addForm = screen.getByRole('form', { name: 'Add a secret' })
    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'GOOGLE_PLACES_API_KEY' } })
    fireEvent.change(within(addForm).getByLabelText('Value'), { target: { value: 'other' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Save secret' }))
    expect(await within(addForm).findByRole('alert')).toHaveTextContent(/already saved; use Replace/)
  })

  it('replaces and removes (after confirming) a secret value with a password field', async () => {
    const setSecretSpy = vi.spyOn(sampleCredentialsBackend, 'setWorkflowSecret')
    const deleteSecretSpy = vi.spyOn(sampleCredentialsBackend, 'deleteWorkflowSecret')
    await openSecretsPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Replace GOOGLE_PLACES_API_KEY' }))
    const valueInput = screen.getByLabelText('Value of GOOGLE_PLACES_API_KEY')
    expect(valueInput).toHaveAttribute('type', 'password')
    expect(screen.getByText('Saved in macOS Keychain, never shown again')).toBeInTheDocument()
    fireEvent.change(valueInput, { target: { value: '[PLACES KEY]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Remove GOOGLE_PLACES_API_KEY' })).toBeInTheDocument()
    expect(setSecretSpy).toHaveBeenCalledWith('GOOGLE_PLACES_API_KEY', '[PLACES KEY]')

    fireEvent.click(screen.getByRole('button', { name: 'Remove GOOGLE_PLACES_API_KEY' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Remove GOOGLE_PLACES_API_KEY?' })
    expect(confirmation).toHaveTextContent('Maps leads to WhatsApp will stop working until you add it again.')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep it' }))
    expect(deleteSecretSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove GOOGLE_PLACES_API_KEY' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove GOOGLE_PLACES_API_KEY' }))
    expect(await screen.findByRole('button', { name: 'Add GOOGLE_PLACES_API_KEY' })).toHaveTextContent('Add value')
    expect(within(getSecretRow('GOOGLE_PLACES_API_KEY')).getByText('Missing')).toBeInTheDocument()
    expect(deleteSecretSpy).toHaveBeenCalledWith('GOOGLE_PLACES_API_KEY')
  })

  it('removes a secret the user added from the list entirely', async () => {
    await sampleCredentialsBackend.addWorkflowSecret({ name: 'DB_PASSWORD', value: '[DB PASSWORD]', note: null })
    renderConnectionsPage('/connections?section=secrets')
    const passwordRow = await screen.findByRole('listitem', { name: 'DB_PASSWORD' })
    fireEvent.click(within(passwordRow).getByRole('button', { name: 'Remove DB_PASSWORD' }))
    expect(within(passwordRow).getByRole('alertdialog')).toHaveTextContent('Agents can no longer use it.')
    fireEvent.click(within(passwordRow).getByRole('button', { name: 'Yes, remove DB_PASSWORD' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'DB_PASSWORD' })).not.toBeInTheDocument())
  })

  it('shows an honest empty state when there are no secrets', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listAllWorkflowSecrets').mockResolvedValue([])
    renderConnectionsPage()
    expect(await within(getSecretsSection()).findByText(/your agents use · None yet/)).toBeInTheDocument()
    expect(within(getSecretsSection()).getByText(/No secrets yet/)).toBeInTheDocument()
  })

  it('finds secrets by name in the search and hides the other sections', async () => {
    renderConnectionsPage()
    await within(getSecretsSection()).findByText(/your agents use · 1 saved/)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'places' } })
    expect(within(getSecretsSection()).getByText('Google Places API key')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
    expect(screen.queryByText('MCP servers')).not.toBeInTheDocument()
  })
})

describe('ConnectionsPage MCP servers', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleMcpServers()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  async function openMcpPanel() {
    renderConnectionsPage()
    expect(await screen.findByText(/any MCP server · 1 added/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
    return screen.findByRole('article', { name: 'files' })
  }

  it('shows the added servers with their tools', async () => {
    const filesCard = await openMcpPanel()
    expect(within(filesCard).getByText(/npx -y @modelcontextprotocol\/server-filesystem/)).toBeInTheDocument()
    expect(within(filesCard).getByText('Connected · 3 tools: read_file, list_directory, search_files')).toBeInTheDocument()
  })

  it('adds a command server whose secret then appears in the Secrets list, tests and removes it', async () => {
    const addSpy = vi.spyOn(sampleMcpServersBackend, 'addMcpServer')
    await openMcpPanel()
    const addForm = screen.getByRole('form', { name: 'Add an MCP server' })
    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'github' } })
    fireEvent.change(within(addForm).getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.change(within(addForm).getByLabelText('Arguments'), { target: { value: '-y  @modelcontextprotocol/server-github' } })
    fireEvent.change(within(addForm).getByLabelText(/Secrets it needs/), { target: { value: 'GITHUB_TOKEN' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add server' }))

    const githubCard = await screen.findByRole('article', { name: 'github' })
    expect(addSpy).toHaveBeenCalledWith({
      name: 'github',
      transport: { kind: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      secretEnv: ['GITHUB_TOKEN'],
      bearerTokenSecret: null,
    })
    expect(within(githubCard).getByText('Not tested yet')).toBeInTheDocument()
    expect(await within(getSecretsSection()).findByText(/your agents use · 1 saved · 1 missing/)).toBeInTheDocument()
    expect(screen.getByText(/any MCP server · 2 added/)).toBeInTheDocument()

    fireEvent.click(within(githubCard).getByRole('button', { name: 'Test github' }))
    expect(await within(githubCard).findByText(/^Connected/)).toBeInTheDocument()
    expect(within(getSecretsSection()).getByText('Used by MCP server github')).toBeInTheDocument()
    fireEvent.click(within(await screen.findByRole('article', { name: 'github' })).getByRole('button', { name: 'Remove github' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'github' })).not.toBeInTheDocument())
  })

  it('adds a URL server with a bearer token secret and explains a rejected name', async () => {
    await openMcpPanel()
    const addForm = screen.getByRole('form', { name: 'Add an MCP server' })
    fireEvent.change(within(addForm).getByLabelText('How graphrt reaches it'), { target: { value: 'http' } })
    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'Bad Name' } })
    fireEvent.change(within(addForm).getByLabelText('Server URL'), { target: { value: 'https://mcp.example.com/mcp' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add server' }))
    expect(await within(addForm).findByRole('alert')).toHaveTextContent('lowercase letters')

    fireEvent.change(within(addForm).getByLabelText('Name'), { target: { value: 'remote' } })
    fireEvent.change(within(addForm).getByLabelText(/bearer token/), { target: { value: 'REMOTE_TOKEN' } })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add server' }))
    const remoteCard = await screen.findByRole('article', { name: 'remote' })
    expect(within(remoteCard).getByText('https://mcp.example.com/mcp')).toBeInTheDocument()
    expect(within(remoteCard).getByText('Secrets: REMOTE_TOKEN')).toBeInTheDocument()
  })

  it('shows why a connection test failed', async () => {
    vi.spyOn(sampleMcpServersBackend, 'testMcpServer').mockImplementation(async (name) => ({
      name,
      transport: { kind: 'stdio', command: 'npx', args: [] },
      secretEnv: [],
      bearerTokenSecret: null,
      knownTools: [],
      lastCheck: { connected: false, error: 'failed to start process', checkedAt: '2026-11-18T10:00:00Z' },
    }))
    vi.spyOn(sampleMcpServersBackend, 'listMcpServers')
      .mockResolvedValueOnce(await sampleMcpServersBackend.listMcpServers())
      .mockResolvedValue([
        {
          name: 'files',
          transport: { kind: 'stdio', command: 'npx', args: [] },
          secretEnv: [],
          bearerTokenSecret: null,
          knownTools: [],
          lastCheck: { connected: false, error: 'failed to start process', checkedAt: '2026-11-18T10:00:00Z' },
        },
      ])
    const filesCard = await openMcpPanel()
    fireEvent.click(within(filesCard).getByRole('button', { name: 'Test files' }))
    expect(await within(screen.getByRole('article', { name: 'files' })).findByText('Could not connect: failed to start process')).toBeInTheDocument()
  })
})


describe('ConnectionsPage MCP section from a link', () => {
  beforeEach(() => resetSampleMcpServers())

  it('opens the add-server form from ?section=mcp', async () => {
    renderConnectionsPage('/connections?section=mcp')
    expect(await screen.findByRole('form', { name: 'Add an MCP server' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('form', { name: 'Add an MCP server' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add an MCP server' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeInTheDocument()
  })
})
