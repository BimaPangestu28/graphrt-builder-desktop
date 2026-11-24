import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { routePaths } from '@/routes'
import { WelcomePage } from '../WelcomePage'

function renderWelcomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.welcome]}>
      <Routes>
        <Route path={routePaths.welcome} element={<WelcomePage />} />
        <Route path={routePaths.newAgent} element={<p>New agent screen</p>} />
        <Route path={routePaths.home} element={<p>Home screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function typeApiKey(apiKey: string) {
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: apiKey } })
}

function getContinueButton() {
  return screen.getByRole('button', { name: 'Continue' })
}

describe('WelcomePage', () => {
  beforeEach(() => resetSampleCredentials())
  afterEach(() => vi.restoreAllMocks())

  it('asks how graphrt should think, says no key is needed and starts with nothing picked', async () => {
    renderWelcomePage()
    expect(screen.getByRole('heading', { name: 'How should graphrt think?' })).toBeInTheDocument()
    expect(screen.getByText(/No API key needed to start/)).toBeInTheDocument()
    expect(await screen.findByText('Found · 2.1.330 (Claude Code)')).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    expect(getContinueButton()).toBeDisabled()
    expect(screen.queryByText(/graphrt credits/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Experimental')).toHaveLength(2)
    expect(screen.getByText(/Usage counts against your Claude plan and its limits/)).toBeInTheDocument()
  })

  it('shows Codex as not installed with a link to its install guide', async () => {
    const openPageSpy = vi.spyOn(sampleCredentialsBackend, 'openModelInstallPage').mockResolvedValue(undefined)
    renderWelcomePage()
    const installLink = await screen.findByRole('link', { name: 'How to install Codex' })
    expect(installLink).toHaveAttribute('href', 'https://developers.openai.com/codex/cli')
    expect(screen.getByRole('radio', { name: 'Use Codex on this computer' })).toBeDisabled()
    fireEvent.click(installLink)
    expect(openPageSpy).toHaveBeenCalledWith('codex-cli')
  })

  it('says a found Codex that does not start, never "Found" with the error as its version', async () => {
    const statuses = await sampleCredentialsBackend.listProviderStatuses()
    const problem = 'Found, but it does not start. Run `codex --version` in Terminal to see why'
    const brokenCodex = statuses.map((status) =>
      status.provider === 'codex-cli' && status.localCli
        ? { ...status, localCli: { ...status.localCli, installed: true, version: null, problem, path: '/usr/bin/codex' } }
        : status,
    )
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockResolvedValue(brokenCodex)
    renderWelcomePage()
    expect(await screen.findByText(problem)).toBeInTheDocument()
    expect(screen.queryByText(/^Found ·.*LIBSYSTEMD/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sign-in not confirmed yet')).not.toBeInTheDocument()
  })

  it('turns Claude Code on, makes its CLI default model the default and remembers the choice', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    renderWelcomePage()
    const claudeCodeRadio = await screen.findByRole('radio', { name: 'Use Claude Code on this computer' })
    await screen.findByText('Found · 2.1.330 (Claude Code)')
    fireEvent.click(claudeCodeRadio)
    fireEvent.click(getContinueButton())
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('claude-code-cli', true)
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'claude-code-cli', name: 'default' })
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('claude-code-cli')
  })

  it('opens the key fields only for the API key choice and needs a key there', async () => {
    renderWelcomePage()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Add an API key' }))
    expect(getContinueButton()).toBeDisabled()
    typeApiKey('sk-test')
    expect(getContinueButton()).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Local model with Ollama' }))
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(getContinueButton()).toBeEnabled()
  })

  it('saves the key and recommended model, then goes to the new agent screen', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    renderWelcomePage()
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep agents running/ }))
    expect(screen.getByRole('checkbox', { name: /Keep agents running/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Add an API key' }))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
    typeApiKey('  sk-ant-test  ')
    fireEvent.click(getContinueButton())
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('anthropic', 'sk-ant-test')
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'anthropic', name: 'claude-haiku-5-5' })
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('api-key')
  })

  it('saves a DeepSeek key with deepseek-chat as the default model', async () => {
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    fireEvent.click(screen.getByRole('radio', { name: 'Add an API key' }))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'deepseek' } })
    typeApiKey('sk-deepseek-test')
    fireEvent.click(getContinueButton())
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'deepseek', name: 'deepseek-chat' })
  })

  it('saves the Ollama address and llama3.2 for a local model, showing that Ollama runs', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setOllamaBaseUrlSpy = vi.spyOn(sampleCredentialsBackend, 'setOllamaBaseUrl')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    expect(await screen.findByText('Running on this computer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Local model with Ollama' }))
    fireEvent.click(getContinueButton())
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setOllamaBaseUrlSpy).toHaveBeenCalledWith('http://localhost:11434')
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'ollama', name: 'llama3.2' })
    expect(setApiKeySpy).not.toHaveBeenCalled()
  })

  it('offers the Ollama download when it is not running', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listAvailableModels').mockResolvedValue([])
    renderWelcomePage()
    const ollamaCard = (await screen.findByText('Not running')).closest('div') as HTMLElement
    expect(within(ollamaCard).getByRole('link', { name: 'Download Ollama' })).toHaveAttribute('href', 'https://ollama.com/download')
  })

  it('lets the user skip without connecting anything and goes Home', async () => {
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    fireEvent.click(screen.getByRole('radio', { name: 'Skip for now — explore first' }))
    fireEvent.click(getContinueButton())
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('skip')
    expect(setDefaultModelSpy).not.toHaveBeenCalled()
  })

  it('works when nothing is set up yet', async () => {
    await sampleCredentialsBackend.deleteApiKey('openai')
    renderWelcomePage()
    expect(await screen.findByText('Found · 2.1.330 (Claude Code)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Skip for now — explore first' }))
    expect(getContinueButton()).toBeEnabled()
  })

  it('stays on the screen and explains a failed save', async () => {
    vi.spyOn(sampleCredentialsBackend, 'setApiKey').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    renderWelcomePage()
    fireEvent.click(screen.getByRole('radio', { name: 'Add an API key' }))
    typeApiKey('sk-test')
    fireEvent.click(getContinueButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your choice: Keychain is locked')
    expect(getContinueButton()).toBeEnabled()
    expect(screen.queryByText('New agent screen')).not.toBeInTheDocument()
    expect(setWelcomeChoiceSpy).not.toHaveBeenCalled()
  })
  it('lists the other AI tools in a compact closed disclosure with what was found', async () => {
    const openPageSpy = vi.spyOn(sampleCredentialsBackend, 'openModelInstallPage').mockResolvedValue(undefined)
    renderWelcomePage()
    const summary = await screen.findByText('More AI tools on this computer')
    const disclosure = summary.closest('details') as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    expect(await within(disclosure).findByText('· 1 found')).toBeInTheDocument()
    const radios = within(disclosure).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['gemini-cli', 'cursor-cli', 'copilot-cli', 'opencode-cli', 'qwen-code-cli'])
    expect(within(disclosure).getByText('Found · 0.71.0')).toBeInTheDocument()
    expect(within(disclosure).getByRole('radio', { name: 'Use Gemini CLI on this computer' })).toBeEnabled()
    expect(within(disclosure).getByRole('radio', { name: 'Use Cursor CLI on this computer' })).toBeDisabled()
    expect(within(disclosure).getAllByText('Not installed')).toHaveLength(4)
    const cursorLink = within(disclosure).getByRole('link', { name: 'How to install Cursor CLI' })
    expect(cursorLink).toHaveAttribute('href', 'https://cursor.com/docs/cli/installation')
    fireEvent.click(cursorLink)
    expect(openPageSpy).toHaveBeenCalledWith('cursor-cli')
    expect(screen.getAllByText('Experimental')).toHaveLength(2)
  })

  it('turns on a found tool from the disclosure and shows its plan-usage note once picked', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    const geminiRadio = await screen.findByRole('radio', { name: 'Use Gemini CLI on this computer' })
    await screen.findByText('Found · 0.71.0')
    expect(screen.queryByText(/Usage counts against your Google \(Gemini\) plan/)).not.toBeInTheDocument()
    fireEvent.click(geminiRadio)
    expect(screen.getByText(/Usage counts against your Google \(Gemini\) plan and its limits/)).toBeInTheDocument()
    expect(screen.getByText('Sign-in not confirmed yet')).toBeInTheDocument()
    fireEvent.click(getContinueButton())
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('gemini-cli', true)
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'gemini-cli', name: 'default' })
  })
})
