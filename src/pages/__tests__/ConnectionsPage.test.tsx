import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { addSamplePluginMcpServer, resetSampleMcpServers, sampleMcpServersBackend } from '@/api/sampleBackend/mcpServers'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { connectionsTabPattern, routePaths } from '@/routes'
import { ConnectionsPage, ConnectionsTabPage } from '../ConnectionsPage'

function CurrentLocation() {
  const location = useLocation()
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
}

function renderConnectionsPage(initialPath = '/connections/models') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePaths.connections} element={<ConnectionsPage />} />
        <Route path={connectionsTabPattern} element={<ConnectionsTabPage />} />
        <Route path={routePaths.plugins} element={<h1>Plugins page</h1>} />
      </Routes>
      <CurrentLocation />
    </MemoryRouter>,
  )
}

function getCurrentLocation() {
  return screen.getByLabelText('Current location')
}

function getTabBar() {
  return screen.getByRole('navigation', { name: 'Connections sections' })
}

function getTab(name: RegExp) {
  return within(getTabBar()).getByRole('link', { name })
}

function getModelsSection() {
  return screen.getByRole('region', { name: 'AI models' })
}

function getSecretsSection() {
  return screen.getByRole('region', { name: 'Secrets' })
}

beforeEach(() => {
  resetSampleCredentials()
  resetSampleAgents()
  resetSamplePlugins()
  resetSampleMcpServers()
})
afterEach(() => vi.restoreAllMocks())

describe('ConnectionsPage tabs', () => {
  it('opens AI models from /connections, with one tab per kind and its status', async () => {
    renderConnectionsPage('/connections')
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument()
    expect(getCurrentLocation()).toHaveTextContent('/connections/models')
    expect(await within(getTabBar()).findByRole('link', { name: 'AI models 1 connected' })).toHaveAttribute('aria-current', 'page')
    expect(await within(getTabBar()).findByRole('link', { name: 'Secrets 1 saved' })).toHaveAttribute('href', '/connections/secrets')
    expect(await within(getTabBar()).findByRole('link', { name: 'MCP servers 1 added' })).toHaveAttribute('href', '/connections/mcp')
    expect(await within(getTabBar()).findByRole('link', { name: 'Apps 1 signed out' })).toHaveAttribute('href', '/connections/apps')
    expect(getModelsSection()).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Secrets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'MCP servers' })).not.toBeInTheDocument()
  })

  it('shows one section per tab and moves between them by link', async () => {
    renderConnectionsPage()
    fireEvent.click(await within(getTabBar()).findByRole('link', { name: /^Secrets/ }))
    expect(getCurrentLocation()).toHaveTextContent('/connections/secrets')
    expect(getTab(/^Secrets/)).toHaveAttribute('aria-current', 'page')
    expect(getTab(/^AI models/)).not.toHaveAttribute('aria-current')
    expect(await within(getSecretsSection()).findByText('Google Places API key')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'AI models' })).not.toBeInTheDocument()

    fireEvent.click(getTab(/^MCP servers/))
    expect(await screen.findByRole('article', { name: 'files' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Secrets' })).not.toBeInTheDocument()
  })

  it('has no search box and no Plugins card: Plugins has its own sidebar item', async () => {
    renderConnectionsPage()
    await within(getModelsSection()).findByText('Default')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Plugins' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open Plugins/ })).not.toBeInTheDocument()
  })

  it('sends an unknown tab to AI models', async () => {
    renderConnectionsPage('/connections/advanced')
    expect(getCurrentLocation()).toHaveTextContent('/connections/models')
    expect(await within(getModelsSection()).findByText('Default')).toBeInTheDocument()
  })

  it('redirects the old plugins address to the Plugins page', async () => {
    renderConnectionsPage('/connections?section=plugins')
    expect(await screen.findByRole('heading', { name: 'Plugins page' })).toBeInTheDocument()
  })

  it('redirects ?section=secrets to the Secrets tab with the add form open', async () => {
    renderConnectionsPage('/connections?section=secrets')
    expect(getCurrentLocation()).toHaveTextContent('/connections/secrets?add=1')
    expect(await screen.findByRole('form', { name: 'Add a secret' })).toBeInTheDocument()
  })

  it('redirects ?section=mcp to the MCP servers tab with the add form open, which Cancel closes', async () => {
    renderConnectionsPage('/connections?section=mcp')
    expect(getCurrentLocation()).toHaveTextContent('/connections/mcp?add=1')
    const addForm = await screen.findByRole('form', { name: 'Add an MCP server' })
    fireEvent.click(within(addForm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add an MCP server' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeInTheDocument()
  })
})

describe('ConnectionsPage AI models and apps', () => {
  it('loads provider statuses for the AI model cards', async () => {
    renderConnectionsPage()
    expect(within(getModelsSection()).getByText('Loading AI models…')).toBeInTheDocument()
    expect(await within(getModelsSection()).findByText('Default')).toBeInTheDocument()
    expect(within(getModelsSection()).getByText('Found on this computer')).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Anthropic' })).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Google Gemini' })).toBeInTheDocument()
  })

  it('shows the Gmail sign-in warning above the tabs and the app accounts on the Apps tab', async () => {
    renderConnectionsPage('/connections/apps')
    expect(await screen.findByRole('alert')).toHaveTextContent('Gmail needs you to sign in again.')
    const appsSection = await screen.findByRole('region', { name: 'Apps' })
    expect(within(appsSection).getByText('WhatsApp')).toBeInTheDocument()
    expect(within(appsSection).getByText('Signed out')).toBeInTheDocument()
  })

  it('reconnects Gmail from the banner, which clears the Apps warning', async () => {
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Gmail' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getTab(/^Apps/)).toHaveAccessibleName('Apps 3 connected')
  })

  it('adds a provider key with the inline form and updates the tab count', async () => {
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
    expect(getTab(/^AI models/)).toHaveAccessibleName('AI models 2 connected')
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
})

describe('ConnectionsPage local CLI models', () => {
  function getLocalCliGroup() {
    return screen.getByRole('group', { name: 'Already signed in on this computer' })
  }

  it('shows Claude Code and Codex as Experimental cards with what was detected', async () => {
    renderConnectionsPage()
    expect(await screen.findByText('Installed · 2.1.330 (Claude Code)')).toBeInTheDocument()
    const group = getLocalCliGroup()
    expect(within(group).getAllByText('Experimental')).toHaveLength(2)
    expect(within(group).getByText('Signed in')).toBeInTheDocument()
    expect(within(group).getByText('Off')).toBeInTheDocument()
    expect(within(group).getAllByText('Not installed')).toHaveLength(2)
    expect(within(group).getByRole('link', { name: 'How to install Codex' })).toHaveAttribute('href', 'https://developers.openai.com/codex/cli')
    expect(within(group).getByText(/Usage counts against your ChatGPT plan/)).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: 'Turn on Codex' })).not.toBeInTheDocument()
    // The tab count does not include CLIs that are off.
    expect(getTab(/^AI models/)).toHaveAccessibleName('AI models 1 connected')
  })

  it('turns Claude Code on, checks the connection on request and makes it the default with a chosen model', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const checkLocalCliSpy = vi.spyOn(sampleCredentialsBackend, 'checkLocalCli')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on Claude Code' }))
    expect(await screen.findByRole('button', { name: 'Turn off Claude Code' })).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('claude-code-cli', true)
    expect(checkLocalCliSpy).not.toHaveBeenCalled()
    expect(getTab(/^AI models/)).toHaveAccessibleName('AI models 2 connected')

    fireEvent.click(screen.getByRole('button', { name: 'Check Claude Code connection' }))
    expect(await screen.findByText('Claude Code answered in 2.1 s')).toBeInTheDocument()

    const modelSelect = await screen.findByRole('combobox', { name: 'Claude Code model' })
    await within(modelSelect).findByRole('option', { name: 'Sonnet (latest)' })
    expect(within(modelSelect).getAllByRole('option')[0]).toHaveTextContent('CLI default')
    fireEvent.change(modelSelect, { target: { value: 'sonnet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Claude Code (on this computer) by default' }))
    expect(await screen.findByText('Model new agents use')).toBeInTheDocument()
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'claude-code-cli', name: 'sonnet' })
    expect(screen.getByRole('combobox', { name: 'Claude Code model' })).toHaveValue('sonnet')
    expect(screen.queryByRole('button', { name: 'Use Claude Code (on this computer) by default' })).not.toBeInTheDocument()
  })

  it('turns Claude Code off again, and the default falls back', async () => {
    await sampleCredentialsBackend.setLocalCliEnabled('claude-code-cli', true)
    await sampleCredentialsBackend.setDefaultModel({ provider: 'claude-code-cli', name: 'default' })
    renderConnectionsPage()
    expect(await screen.findByText('Model new agents use')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Claude Code model' })).toHaveValue('default')
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Claude Code' }))
    expect(await screen.findByRole('button', { name: 'Turn on Claude Code' })).toBeInTheDocument()
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'openai', name: 'gpt-4o-mini' })
  })

  it('looks for the CLIs again on Detect again', async () => {
    const listProviderStatusesSpy = vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Detect Codex again' }))
    await waitFor(() => expect(listProviderStatusesSpy).toHaveBeenCalledWith(true))
  })
})

describe('ConnectionsPage more local CLI tools', () => {
  function getMoreToolsGroup() {
    return screen.getByRole('group', { name: 'More AI tools on this computer' })
  }

  it('shows found tools as cards and collapses the ones that are not installed', async () => {
    renderConnectionsPage()
    expect(await screen.findByText('Installed · 0.71.0')).toBeInTheDocument()
    const group = getMoreToolsGroup()
    expect(within(group).getByRole('button', { name: 'Turn on Gemini CLI' })).toBeInTheDocument()
    expect(within(group).getByText('Sign-in not confirmed yet')).toBeInTheDocument()
    const other = within(group).getByText('Other AI tools you can use').closest('details') as HTMLDetailsElement
    expect(other.open).toBe(false)
    expect(within(other).getByText('· Cursor CLI, GitHub Copilot CLI, OpenCode, Qwen Code')).toBeInTheDocument()
    expect(within(other).queryByText('Installed · 0.71.0')).not.toBeInTheDocument()
    expect(within(other).getByRole('link', { name: 'How to install OpenCode' })).toHaveAttribute('href', 'https://opencode.ai/docs/')
    expect(within(other).getByRole('button', { name: 'Detect GitHub Copilot CLI again' })).toBeInTheDocument()
    expect(within(other).queryByRole('button', { name: 'Turn on Qwen Code' })).not.toBeInTheDocument()
    expect(within(group).getByText(/Usage counts against the AI provider accounts OpenCode is signed in to/)).toBeInTheDocument()
    // Claude Code and Codex keep their own group.
    expect(within(screen.getByRole('group', { name: 'Already signed in on this computer' })).queryByText('Installed · 0.71.0')).not.toBeInTheDocument()
  })

  it('turns Gemini CLI on and then offers its models', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const checkLocalCliSpy = vi.spyOn(sampleCredentialsBackend, 'checkLocalCli')
    renderConnectionsPage()
    expect(screen.queryByRole('combobox', { name: 'Gemini CLI model' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on Gemini CLI' }))
    expect(await screen.findByRole('button', { name: 'Turn off Gemini CLI' })).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('gemini-cli', true)
    expect(checkLocalCliSpy).not.toHaveBeenCalled()
    const modelSelect = await screen.findByRole('combobox', { name: 'Gemini CLI model' })
    expect(await within(modelSelect).findByRole('option', { name: 'Flash (latest)' })).toBeInTheDocument()
    expect(within(modelSelect).getAllByRole('option')[0]).toHaveTextContent('CLI default')
  })
})

describe('ConnectionsPage secrets', () => {
  async function openSecretsPanel() {
    renderConnectionsPage('/connections/secrets')
    expect(await within(getSecretsSection()).findByText('Google Places API key')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add secret' }))
    return getSecretsSection()
  }

  function getSecretRow(name: string) {
    return within(getSecretsSection()).getByRole('listitem', { name })
  }

  it('lists every secret with who uses it and whether it is saved', async () => {
    const secretsPanel = await openSecretsPanel()
    expect(within(secretsPanel).getByText('GOOGLE_PLACES_API_KEY · Used by Maps leads to WhatsApp')).toBeInTheDocument()
    expect(within(secretsPanel).getByText('Saved')).toBeInTheDocument()
    expect(within(secretsPanel).queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument()
    fireEvent.click(within(secretsPanel).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
    expect(within(secretsPanel).getByText('Google Places API key')).toBeInTheDocument()
  })

  it('lists the secrets without opening anything', async () => {
    renderConnectionsPage('/connections/secrets')
    expect(await within(getSecretsSection()).findByText('Google Places API key')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Add a secret' })).not.toBeInTheDocument()
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
    expect(getTab(/^Secrets/)).toHaveAccessibleName('Secrets 2 saved')
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

  it('replaces and removes (after confirming) a secret value, and the tab then reports it missing', async () => {
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
    expect(getTab(/^Secrets/)).toHaveAccessibleName('Secrets 1 missing')
  })

  it('removes a secret the user added from the list entirely', async () => {
    await sampleCredentialsBackend.addWorkflowSecret({ name: 'DB_PASSWORD', value: '[DB PASSWORD]', note: null })
    renderConnectionsPage('/connections/secrets')
    const passwordRow = await screen.findByRole('listitem', { name: 'DB_PASSWORD' })
    fireEvent.click(within(passwordRow).getByRole('button', { name: 'Remove DB_PASSWORD' }))
    expect(within(passwordRow).getByRole('alertdialog')).toHaveTextContent('Agents can no longer use it.')
    fireEvent.click(within(passwordRow).getByRole('button', { name: 'Yes, remove DB_PASSWORD' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'DB_PASSWORD' })).not.toBeInTheDocument())
  })

  it('shows an honest empty state, and no count on the tab, when there are no secrets', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listAllWorkflowSecrets').mockResolvedValue([])
    renderConnectionsPage('/connections/secrets')
    expect(await within(getSecretsSection()).findByText(/No secrets yet/)).toBeInTheDocument()
    expect(getTab(/^Secrets/)).toHaveAccessibleName('Secrets')
  })
})

describe('ConnectionsPage MCP servers', () => {
  async function openMcpPanel() {
    renderConnectionsPage('/connections/mcp')
    const filesCard = await screen.findByRole('article', { name: 'files' })
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
    return filesCard
  }

  it('shows the added servers with their tools', async () => {
    const filesCard = await openMcpPanel()
    expect(within(filesCard).getByText(/npx -y @modelcontextprotocol\/server-filesystem/)).toBeInTheDocument()
    expect(within(filesCard).getByText('Connected · 3 tools: read_file, list_directory, search_files')).toBeInTheDocument()
    expect(getTab(/^MCP servers/)).toHaveAccessibleName('MCP servers 1 added')
  })

  it('adds a command server whose secret then shows as missing on the Secrets tab, tests and removes it', async () => {
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
    await waitFor(() => expect(getTab(/^Secrets/)).toHaveAccessibleName('Secrets 1 missing'))
    expect(getTab(/^MCP servers/)).toHaveAccessibleName('MCP servers 2 added')

    fireEvent.click(within(githubCard).getByRole('button', { name: 'Test github' }))
    expect(await within(githubCard).findByText(/^Connected/)).toBeInTheDocument()
    fireEvent.click(getTab(/^Secrets/))
    expect(await within(getSecretsSection()).findByText('Used by MCP server github')).toBeInTheDocument()

    fireEvent.click(getTab(/^MCP servers/))
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

  it('shows the Upwork plugin server, signs in and lets the user relax one tool', async () => {
    addSamplePluginMcpServer('upwork', 'https://mcp.upwork.com/mcp')
    renderConnectionsPage('/connections/mcp')

    const upworkCard = await screen.findByRole('article', { name: 'upwork' })
    expect(within(upworkCard).getByText('From the upwork plugin')).toBeInTheDocument()
    expect(within(upworkCard).queryByRole('button', { name: 'Remove upwork' })).not.toBeInTheDocument()
    expect(within(upworkCard).getByText('Not signed in')).toBeInTheDocument()
    fireEvent.click(within(upworkCard).getByRole('button', { name: 'Sign in to upwork' }))

    expect(await within(screen.getByRole('article', { name: 'upwork' })).findByText('Signed in')).toBeInTheDocument()
    const signedInCard = screen.getByRole('article', { name: 'upwork' })
    expect(within(signedInCard).getByText(/Approvals: 3 of 6 tools ask you first/)).toBeInTheDocument()
    fireEvent.click(within(signedInCard).getByRole('button', { name: 'Let send_message run without asking' }))
    expect(await within(screen.getByRole('article', { name: 'upwork' })).findByText('Runs on its own (you chose)')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'upwork' })).getByRole('button', { name: 'Make send_message ask first' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'upwork' })).getByRole('button', { name: 'Sign out of upwork' })).toBeInTheDocument()
  })

  it('asks to sign in again when the stored sign-in was rejected', async () => {
    vi.spyOn(sampleMcpServersBackend, 'listMcpServers').mockResolvedValue([
      {
        name: 'upwork',
        transport: { kind: 'http', url: 'https://mcp.upwork.com/mcp' },
        secretEnv: [],
        bearerTokenSecret: null,
        auth: 'oauth',
        plugin: 'upwork',
        approval: { readOnly: ['find_*', 'get_*', 'list_*', 'search_*'], defaultAsks: true },
        knownTools: [],
        lastCheck: null,
        signIn: { state: 'expired', reason: 'the sign-in expired or was revoked (invalid_grant)' },
      },
    ])
    renderConnectionsPage('/connections/mcp')
    const upworkCard = await screen.findByRole('article', { name: 'upwork' })
    expect(within(upworkCard).getByText('Sign in again: the sign-in expired or was revoked (invalid_grant)')).toBeInTheDocument()
    expect(within(upworkCard).getByRole('button', { name: 'Sign in to upwork' })).toHaveTextContent('Sign in again')
  })

  it('shows why signing in failed', async () => {
    vi.spyOn(sampleMcpServersBackend, 'signInMcpServer').mockRejectedValue(new BackendError('invalid_input', 'sign-in was not completed: access was denied'))
    addSamplePluginMcpServer('upwork', 'https://mcp.upwork.com/mcp')
    renderConnectionsPage('/connections/mcp')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to upwork' }))
    expect(await screen.findByText('Could not sign in to upwork: sign-in was not completed: access was denied')).toBeInTheDocument()
  })

  it('cancels a sign-in that waits for the browser without showing an error', async () => {
    let rejectSignIn: (error: Error) => void = () => undefined
    vi.spyOn(sampleMcpServersBackend, 'signInMcpServer').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSignIn = reject
        }),
    )
    const cancelSpy = vi.spyOn(sampleMcpServersBackend, 'cancelMcpSignIn').mockImplementation(async () => {
      rejectSignIn(new BackendError('stopped', 'Stopped by you'))
    })
    addSamplePluginMcpServer('upwork', 'https://mcp.upwork.com/mcp')
    renderConnectionsPage('/connections/mcp')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to upwork' }))
    expect(await screen.findByText('Finish signing in in your browser…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel signing in to upwork' }))
    expect(await screen.findByRole('button', { name: 'Sign in to upwork' })).toBeInTheDocument()
    expect(cancelSpy).toHaveBeenCalledWith('upwork')
    expect(screen.queryByText(/Could not sign in/)).not.toBeInTheDocument()
  })
})
