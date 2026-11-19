import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { resetSampleMcpServers, sampleMcpServersBackend } from '@/api/sampleBackend/mcpServers'
import { emitSamplePluginEvent, resetSamplePlugins, samplePluginsBackend, setSampleBrowserRuntimeStatus } from '@/api/sampleBackend/plugins'
import { connectionsPluginsPath } from '@/routes'
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
    expect(within(getModelsSection()).getByText('Found on this Mac')).toBeInTheDocument()
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

function getAdvancedSection() {
  return screen.getByRole('region', { name: 'Advanced' })
}

describe('ConnectionsPage secrets', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleMcpServers()
  })
  afterEach(() => vi.restoreAllMocks())

  async function openSecretsPanel() {
    renderConnectionsPage()
    expect(await within(getAdvancedSection()).findByText(/your agents use · 1 saved/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Secrets' }))
    return screen.getByRole('region', { name: 'Secrets' })
  }

  function getSecretRow(name: string) {
    return within(screen.getByRole('region', { name: 'Secrets' })).getByRole('listitem', { name })
  }

  it('lists every secret with who uses it and whether it is saved', async () => {
    const secretsPanel = await openSecretsPanel()
    expect(within(secretsPanel).getByText('Google Places API key')).toBeInTheDocument()
    expect(within(secretsPanel).getByText('GOOGLE_PLACES_API_KEY · Used by Maps leads to WhatsApp')).toBeInTheDocument()
    expect(within(secretsPanel).getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Secrets' })).toHaveTextContent('Done')
  })

  it('opens the Secrets panel from ?section=secrets', async () => {
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

    expect(await within(addForm).findByText('MY_SERVER_TOKEN is saved in the keychain. Agents read it as {{#env.MY_SERVER_TOKEN#}}')).toBeInTheDocument()
    expect(addSecretSpy).toHaveBeenCalledWith({ name: 'MY_SERVER_TOKEN', value: '[SERVER TOKEN]', note: 'Home server deploys' })
    const serverTokenRow = getSecretRow('MY_SERVER_TOKEN')
    expect(within(serverTokenRow).getByText(/^Home server deploys · Not used yet · Saved Just now$/)).toBeInTheDocument()
    expect(within(serverTokenRow).getByText('Saved')).toBeInTheDocument()
    expect(within(addForm).getByLabelText('Value')).toHaveValue('')
    expect(screen.queryByText('[SERVER TOKEN]')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('[SERVER TOKEN]')).not.toBeInTheDocument()
    expect(within(getAdvancedSection()).getByText(/your agents use · 2 saved/)).toBeInTheDocument()
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
    expect(screen.getByText('Saved in the keychain, never shown again')).toBeInTheDocument()
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
    expect(await screen.findByRole('button', { name: 'Add GOOGLE_PLACES_API_KEY' })).toHaveTextContent('Missing — add value')
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
    expect(await within(getAdvancedSection()).findByText(/your agents use · None yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Secrets' }))
    expect(within(getAdvancedSection()).getByText(/No secrets yet/)).toBeInTheDocument()
  })

  it('finds secrets by name in the search and opens the panel for them', async () => {
    renderConnectionsPage()
    await within(getAdvancedSection()).findByText(/your agents use · 1 saved/)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'places' } })
    expect(within(getAdvancedSection()).getByText('Google Places API key')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Manage MCP servers' }))
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
    expect(await within(getAdvancedSection()).findByText(/your agents use · 1 saved · 1 missing/)).toBeInTheDocument()
    expect(screen.getByText(/any MCP server · 2 added/)).toBeInTheDocument()

    fireEvent.click(within(githubCard).getByRole('button', { name: 'Test github' }))
    expect(await within(githubCard).findByText(/^Connected/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Secrets' }))
    expect(within(getAdvancedSection()).getByText('Used by MCP server github')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage MCP servers' }))
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

function getPluginCard(pluginName: string) {
  return screen.getByRole('article', { name: pluginName })
}

/** Opens a plugin row's details (Manage / Details) unless they are open already. */
function openPluginDetails(pluginName: string) {
  const toggle = within(getPluginCard(pluginName)).getByRole('button', { name: new RegExp(`^(Manage|Details for) ${pluginName}$`) })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  return getPluginCard(pluginName)
}

async function openPluginsPanel(installedCount = 2) {
  renderConnectionsPage()
  expect(await screen.findByText(new RegExp(`WebAssembly · ${installedCount} installed`))).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Plugins' }))
  return screen.findByRole('article', { name: 'whatsapp-api' })
}

describe('ConnectionsPage plugins', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the installed count and opens the Plugins panel from Manage or the URL', async () => {
    renderConnectionsPage(connectionsPluginsPath)
    expect(await screen.findByRole('region', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Plugins' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Plugins' }))
    expect(screen.queryByRole('region', { name: 'Plugins' })).not.toBeInTheDocument()
  })

  it('shows what a plugin asks for before it is installed, then installs it', async () => {
    const whatsAppApiCard = await openPluginsPanel()
    expect(within(whatsAppApiCard).getByRole('list', { name: 'whatsapp-api needs' })).toHaveTextContent(/Internet.*Secrets.*4 settings/)
    expect(within(whatsAppApiCard).queryByRole('list', { name: 'What whatsapp-api asks for' })).not.toBeInTheDocument()
    openPluginDetails('whatsapp-api')
    const permissions = within(whatsAppApiCard).getByRole('list', { name: 'What whatsapp-api asks for' })
    expect(permissions).toHaveTextContent('Connects to the internet')
    expect(permissions).toHaveTextContent('Receives secret values in plain text')
    expect(permissions).toHaveTextContent('WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID')
    expect(within(whatsAppApiCard).getByText(/Send WhatsApp text/)).toBeInTheDocument()

    fireEvent.click(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' }))
    await waitFor(() => expect(within(getPluginCard('whatsapp-api')).getByText('Installed v0.3.0')).toBeInTheDocument())
    expect(within(getPluginCard('whatsapp-api')).getByText('Not trusted')).toBeInTheDocument()
    expect(within(getPluginCard('whatsapp-api')).getByRole('button', { name: 'Manage whatsapp-api' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(getPluginCard('whatsapp-api')).getByRole('checkbox', { name: 'Trust whatsapp-api' })).not.toBeChecked()
    expect(screen.getByText(/WebAssembly · 3 installed/)).toBeInTheDocument()
  })

  it('shows install progress from plugin events', async () => {
    vi.spyOn(samplePluginsBackend, 'installPlugin').mockImplementation(() => new Promise(() => {}))
    const whatsAppApiCard = await openPluginsPanel()
    fireEvent.click(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' }))
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'downloading', receivedBytes: 20, totalBytes: 50, message: null }))
    expect(within(whatsAppApiCard).getByRole('status')).toHaveTextContent('Downloading · 40%')
    expect(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' })).toBeDisabled()
  })

  it('trusts a plugin next to a clear warning', async () => {
    const setTrustedSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    await openPluginsPanel()
    const websiteCheckCard = openPluginDetails('website-check')
    expect(within(websiteCheckCard).getByText(/Plugins run code on this computer: only trust plugins you know/)).toBeInTheDocument()
    fireEvent.click(within(websiteCheckCard).getByRole('checkbox', { name: 'Trust website-check' }))
    expect(await within(getPluginCard('website-check')).findByRole('checkbox', { name: 'Trust website-check' })).toBeChecked()
    await waitFor(() => expect(within(getPluginCard('website-check')).queryByText('Not trusted')).not.toBeInTheDocument())
    expect(setTrustedSpy).toHaveBeenCalledWith('website-check', true)
  })

  it('folds optional settings away and shows only required ones', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await samplePluginsBackend.installPlugin('whatsapp-web')
    await openPluginsPanel(4)

    const whatsAppApiCard = getPluginCard('whatsapp-api')
    expect(within(whatsAppApiCard).getByLabelText('WHATSAPP_ACCESS_TOKEN')).toBeVisible()
    expect(within(whatsAppApiCard).getByLabelText('WHATSAPP_GRAPH_VERSION')).not.toBeVisible()

    const whatsAppWebCard = getPluginCard('whatsapp-web')
    // No required settings: no inputs until "Optional settings" is opened.
    for (const input of within(whatsAppWebCard).getAllByLabelText(/^WHATSAPP_WEB_/)) expect(input).not.toBeVisible()
    const optionalToggle = within(whatsAppWebCard).getByText('Optional settings (5)')
    expect(within(whatsAppWebCard).getByText('Defaults work for most people')).not.toBeVisible()
    fireEvent.click(optionalToggle)
    expect(within(whatsAppWebCard).getByText('Defaults work for most people')).toBeVisible()
    expect(within(whatsAppWebCard).getByLabelText('WHATSAPP_WEB_DAILY_SEND_LIMIT')).toBeVisible()
  })

  it('links whatsapp-web by QR code from its card once trusted and the browser is ready', async () => {
    setSampleBrowserRuntimeStatus('installed')
    await samplePluginsBackend.installPlugin('whatsapp-web')
    await openPluginsPanel(3)
    const card = getPluginCard('whatsapp-web')
    expect(card).toHaveTextContent('Trust the plugin, then link WhatsApp by scanning a QR code')
    expect(within(card).queryByRole('button', { name: 'Link WhatsApp (scan QR code)' })).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole('checkbox', { name: 'Trust whatsapp-web' }))
    const linkPanel = await within(getPluginCard('whatsapp-web')).findByRole('region', { name: 'Link WhatsApp' })
    expect(await within(linkPanel).findByRole('status')).toHaveTextContent('WhatsApp: Not linked')
    expect(linkPanel).toHaveTextContent('A window with a QR code opens. On your phone: WhatsApp → Settings → Linked devices → Link a device')

    fireEvent.click(within(linkPanel).getByRole('button', { name: 'Link WhatsApp (scan QR code)' }))
    expect(await within(linkPanel).findByText('Linked')).toBeInTheDocument()
  })

  it('saves and clears a setting without ever showing its value', async () => {
    await openPluginsPanel()
    const settingForm = within(openPluginDetails('google-maps-scraper')).getByRole('form', { name: 'google-maps-scraper setting GOOGLE_MAPS_LANGUAGE' })
    expect(within(settingForm).getByText('Not set')).toBeInTheDocument()
    const settingInput = within(settingForm).getByLabelText('GOOGLE_MAPS_LANGUAGE')
    expect(settingInput).toHaveAttribute('type', 'password')
    fireEvent.change(settingInput, { target: { value: '[LANGUAGE]' } })
    fireEvent.click(within(settingForm).getByRole('button', { name: 'Save GOOGLE_MAPS_LANGUAGE' }))
    expect(await within(settingForm).findByText('Saved')).toBeInTheDocument()
    expect(settingInput).toHaveValue('')
    fireEvent.click(within(settingForm).getByRole('button', { name: 'Clear GOOGLE_MAPS_LANGUAGE' }))
    expect(await within(settingForm).findByText('Not set')).toBeInTheDocument()
  })

  it('updates and removes an installed plugin', async () => {
    await openPluginsPanel()
    fireEvent.click(within(getPluginCard('google-maps-scraper')).getByRole('button', { name: 'Update google-maps-scraper' }))
    expect(await within(getPluginCard('google-maps-scraper')).findByText('Installed v1.1.0')).toBeInTheDocument()
    expect(within(getPluginCard('google-maps-scraper')).queryByRole('button', { name: 'Update google-maps-scraper' })).not.toBeInTheDocument()
    fireEvent.click(within(openPluginDetails('website-check')).getByRole('button', { name: 'Remove website-check' }))
    await waitFor(() => expect(within(getPluginCard('website-check')).getByRole('button', { name: 'Install website-check' })).toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'Available · 3' })).toContainElement(getPluginCard('website-check'))
  })

  it('groups installed plugins before available ones, details collapsed until opened', async () => {
    await openPluginsPanel()
    const installedGroup = screen.getByRole('region', { name: 'Installed · 2' })
    const availableGroup = screen.getByRole('region', { name: 'Available · 2' })
    expect(within(installedGroup).getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['google-maps-scraper', 'website-check'])
    expect(within(availableGroup).getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['whatsapp-api', 'whatsapp-web'])
    // google-maps-scraper only has an optional setting (GOOGLE_MAPS_LANGUAGE), so nothing needs attention.
    expect(within(getPluginCard('google-maps-scraper')).getByRole('button', { name: 'Manage google-maps-scraper' })).toHaveAttribute('aria-expanded', 'false')
    const manageButton = within(getPluginCard('website-check')).getByRole('button', { name: 'Manage website-check' })
    expect(manageButton).toHaveAttribute('aria-expanded', 'false')
    expect(within(getPluginCard('website-check')).queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(manageButton)
    expect(manageButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(getPluginCard('website-check')).getByRole('checkbox', { name: 'Trust website-check' })).not.toBeChecked()
  })

  it('filters plugins by name or description', async () => {
    await openPluginsPanel()
    const searchBox = screen.getByRole('searchbox', { name: 'Search plugins' })
    fireEvent.change(searchBox, { target: { value: 'WHATSAPP' } })
    expect(screen.queryByRole('article', { name: 'website-check' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Available · 2' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Installed/ })).not.toBeInTheDocument()
    fireEvent.change(searchBox, { target: { value: 'no such plugin' } })
    expect(screen.getByText('No plugins match “no such plugin”')).toBeInTheDocument()
    fireEvent.change(searchBox, { target: { value: '' } })
    expect(screen.getAllByRole('article')).toHaveLength(4)
  })

  it('installs the browser runtime when an installed plugin needs it', async () => {
    await openPluginsPanel()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install browser runtime' }))
    expect(await screen.findByText('Installed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install browser runtime' })).not.toBeInTheDocument()
  })

  it('shows the error when an action fails', async () => {
    vi.spyOn(samplePluginsBackend, 'removePlugin').mockRejectedValue(new BackendError('internal', 'The plugin folder is in use'))
    await openPluginsPanel()
    fireEvent.click(within(openPluginDetails('website-check')).getByRole('button', { name: 'Remove website-check' }))
    expect(await within(getPluginCard('website-check')).findByRole('alert')).toHaveTextContent('Could not remove website-check: The plugin folder is in use')
  })

  it('shows load errors and warnings of installed plugins', async () => {
    const listInstalled = samplePluginsBackend.listInstalledPlugins
    vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockImplementation(async () => {
      const installedPlugins = await listInstalled()
      return installedPlugins.map((installedPlugin) => (installedPlugin.name === 'website-check' ? { ...installedPlugin, loadError: 'checksum mismatch' } : installedPlugin))
    })
    renderConnectionsPage(connectionsPluginsPath)
    const websiteCheckCard = await screen.findByRole('article', { name: 'website-check' })
    expect(within(websiteCheckCard).getByRole('alert')).toHaveTextContent('Could not load website-check: checksum mismatch')
    expect(within(websiteCheckCard).getByRole('button', { name: 'Manage website-check' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps installed plugins when the catalog cannot be loaded', async () => {
    vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockRejectedValue(new BackendError('internal', 'You are offline'))
    renderConnectionsPage(connectionsPluginsPath)
    expect(await screen.findByText(/Could not load the plugin catalog: You are offline/)).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'website-check' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'whatsapp-api' })).not.toBeInTheDocument()
  })
})
