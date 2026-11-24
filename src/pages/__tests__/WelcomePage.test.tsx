import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import type { ProviderStatus } from '@/api/types'
import { routePaths } from '@/routes'
import { WelcomePage } from '../WelcomePage'

const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'

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

function clickButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function expectStep(stepNumber: number, stepCount: number) {
  expect(screen.getByText(`Step ${stepNumber} of ${stepCount}`)).toBeInTheDocument()
}

/** From Welcome to the Thinking step, once detection has preselected an answer. */
async function openThinkingStep() {
  renderWelcomePage()
  clickButton(/Get started/)
  await screen.findByRole('heading', { name: 'How should your agents think?' })
  await screen.findByText('Found your Claude account and your Google (Gemini) account')
}

function pickApproach(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }))
}

/** Next on Connect (when there is one) and Background, landing on Done. */
function goFromConnectToDone() {
  if (screen.queryByText('Step 3 of 5')) clickButton(/Next/)
  clickButton(/Next/)
  expect(screen.getByRole('heading', { name: 'You’re all set' })).toBeInTheDocument()
}

describe('WelcomePage wizard', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAppSettings()
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on a plain welcome with progress and no Back button', () => {
    renderWelcomePage()
    expect(screen.getByRole('heading', { name: 'Welcome to graphrt' })).toBeInTheDocument()
    expectStep(1, 5)
    expect(within(screen.getByRole('list', { name: 'Setup progress' })).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Get started/ })).toBeEnabled()
  })

  it('preselects the signed-in AI account as recommended and keeps developer details closed', async () => {
    await openThinkingStep()
    expectStep(2, 5)
    expect(screen.getByRole('radio', { name: 'Use an AI account I already have' })).toBeChecked()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText(/change it any time in Connections/)).toBeInTheDocument()
    expect(screen.getByText('Already running on this computer')).toBeInTheDocument()
    const details = screen.getByText('What graphrt found on this computer').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(details).getByText(/2\.1\.330/)).not.toBeVisible()
    expect(within(details).getByText(/Experimental/)).not.toBeVisible()
  })

  it('connects the signed-in Claude account the same way the old screen did', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    await openThinkingStep()
    clickButton(/Next/)
    expectStep(3, 5)
    expect(screen.getByRole('radio', { name: 'Your Claude account' })).toBeChecked()
    expect(screen.getByText('Signed in and ready')).toBeInTheDocument()
    goFromConnectToDone()
    expect(screen.getByText('Your Claude account (through Claude Code)')).toBeInTheDocument()
    clickButton('Build my first agent')
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('claude-code-cli', true)
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'claude-code-cli', name: 'default' })
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('claude-code-cli')
  })

  it('lets the user pick another found AI tool and keeps install links for the missing ones', async () => {
    const setLocalCliEnabledSpy = vi.spyOn(sampleCredentialsBackend, 'setLocalCliEnabled')
    const openPageSpy = vi.spyOn(sampleCredentialsBackend, 'openModelInstallPage').mockResolvedValue(undefined)
    await openThinkingStep()
    clickButton(/Next/)
    fireEvent.click(screen.getByRole('radio', { name: 'Your Google (Gemini) account' }))
    expect(screen.getByText(/graphrt confirms the sign-in when your first agent runs/)).toBeInTheDocument()
    expect(screen.getByText(/Usage counts against your Google \(Gemini\) plan and its limits/)).toBeInTheDocument()
    const codexLink = screen.getByRole('link', { name: 'How to install Codex' })
    expect(codexLink).toHaveAttribute('href', 'https://developers.openai.com/codex/cli')
    fireEvent.click(codexLink)
    expect(openPageSpy).toHaveBeenCalledWith('codex-cli')
    goFromConnectToDone()
    clickButton('Build my first agent')
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setLocalCliEnabledSpy).toHaveBeenCalledWith('gemini-cli', true)
  })

  it('checks the company key locally, suggests the right provider, then saves key and model', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    await openThinkingStep()
    pickApproach('Use my company’s API key')
    clickButton(/Next/)
    expect(screen.getByRole('heading', { name: 'Add your company’s API key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } })
    expect(screen.getByText(/This key looks too short/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: `  ${anthropicKey}  ` } })
    expect(screen.getByText('This key looks like it is from Anthropic, not OpenAI')).toBeInTheDocument()
    clickButton('Switch to Anthropic')
    expect(screen.getByLabelText('Provider')).toHaveValue('anthropic')
    expect(screen.getByText('Looks good')).toBeInTheDocument()
    goFromConnectToDone()
    expect(screen.getByText('Your company’s Anthropic key')).toBeInTheDocument()
    clickButton('Build my first agent')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('anthropic', anthropicKey)
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'anthropic', name: 'claude-haiku-5-5' })
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('api-key')
  })

  it('saves a DeepSeek key with deepseek-chat as the default model', async () => {
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    await openThinkingStep()
    pickApproach('Use my company’s API key')
    clickButton(/Next/)
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'deepseek' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-deepseek-abcdefghijklmnopqrstuvwxyz' } })
    goFromConnectToDone()
    clickButton('Build my first agent')
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'deepseek', name: 'deepseek-chat' })
  })

  it('saves the Ollama address and llama3.2 for free private AI', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setOllamaBaseUrlSpy = vi.spyOn(sampleCredentialsBackend, 'setOllamaBaseUrl')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    await openThinkingStep()
    pickApproach('Free, private AI on this computer')
    clickButton(/Next/)
    expect(screen.getByText('Ollama is running. You are ready to go')).toBeInTheDocument()
    goFromConnectToDone()
    clickButton('Build my first agent')
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setOllamaBaseUrlSpy).toHaveBeenCalledWith('http://localhost:11434')
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'ollama', name: 'llama3.2' })
    expect(setApiKeySpy).not.toHaveBeenCalled()
  })

  it('shows how to get Ollama when it is not running, with Check again', async () => {
    const listModelsSpy = vi.spyOn(sampleCredentialsBackend, 'listAvailableModels').mockResolvedValue([])
    await openThinkingStep()
    pickApproach('Free, private AI on this computer')
    clickButton(/Next/)
    expect(screen.getByRole('link', { name: 'Download Ollama' })).toHaveAttribute('href', 'https://ollama.com/download')
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled()
    clickButton('Check again')
    expect(listModelsSpy).toHaveBeenLastCalledWith(true)
  })

  it('recommends a company key and disables the account choice when nothing is found', async () => {
    const statuses = await sampleCredentialsBackend.listProviderStatuses()
    const withoutTools: ProviderStatus[] = statuses.map((status) => (status.localCli ? { ...status, localCli: { ...status.localCli, installed: false, signIn: 'unknown' } } : status))
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockResolvedValue(withoutTools)
    vi.spyOn(sampleCredentialsBackend, 'listAvailableModels').mockResolvedValue([])
    renderWelcomePage()
    clickButton(/Get started/)
    expect(await screen.findByText('None found on this computer')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Use an AI account I already have' })).toBeDisabled()
    expect(await screen.findByRole('radio', { name: 'Use my company’s API key' })).toBeChecked()
  })

  it('shows a found AI tool that does not start in plain words, never as "Found" with the error as its version', async () => {
    const statuses = await sampleCredentialsBackend.listProviderStatuses()
    const problem = 'Found, but it does not start. Run `codex --version` in Terminal to see why'
    const brokenCodex = statuses.map((status) =>
      status.provider === 'codex-cli' && status.localCli ? { ...status, localCli: { ...status.localCli, installed: true, version: null, problem, path: '/usr/bin/codex' } } : status,
    )
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockResolvedValue(brokenCodex)
    await openThinkingStep()
    clickButton(/Next/)
    expect(screen.getByRole('radio', { name: 'Your ChatGPT account' })).toBeDisabled()
    expect(screen.getByText(/Found, but it does not start on this computer yet/)).toBeVisible()
    expect(screen.queryByText(/^Found ·/)).not.toBeInTheDocument()
    expect(screen.getByText(/Codex: Found, but it does not start/)).not.toBeVisible()
  })

  it('does not offer the account choice when the only AI tool found does not start', async () => {
    const statuses = await sampleCredentialsBackend.listProviderStatuses()
    const onlyBrokenCodex: ProviderStatus[] = statuses.map((status) => {
      if (!status.localCli) return status
      if (status.provider === 'codex-cli') return { ...status, localCli: { ...status.localCli, installed: true, version: null, problem: 'Found, but it does not start.' } }
      return { ...status, localCli: { ...status.localCli, installed: false, signIn: 'unknown' } }
    })
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockResolvedValue(onlyBrokenCodex)
    renderWelcomePage()
    clickButton(/Get started/)
    expect(await screen.findByText('Found Codex, but it does not start on this computer yet')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Use an AI account I already have' })).toBeDisabled()
    expect(await screen.findByRole('radio', { name: 'Free, private AI on this computer' })).toBeChecked()
  })

  it('skips Connect for "Decide later" and goes Home without saving a model', async () => {
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    await openThinkingStep()
    pickApproach('Decide later')
    expectStep(2, 4)
    clickButton(/Next/)
    expectStep(3, 4)
    expect(screen.getByRole('heading', { name: 'Keep agents working after you close the window?' })).toBeInTheDocument()
    clickButton(/Next/)
    clickButton('Explore graphrt')
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(setWelcomeChoiceSpy).toHaveBeenCalledWith('skip')
    expect(setDefaultModelSpy).not.toHaveBeenCalled()
  })

  it('saves "keep running" only when it changes', async () => {
    const updateSettingsSpy = vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings')
    await openThinkingStep()
    pickApproach('Decide later')
    clickButton(/Next/)
    const keepRunning = screen.getByRole('checkbox', { name: /Keep agents running from the menu bar/ })
    expect(keepRunning).toBeChecked()
    fireEvent.click(keepRunning)
    clickButton(/Next/)
    expect(screen.getByText('graphrt quits and agents stop')).toBeInTheDocument()
    clickButton('Explore graphrt')
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(updateSettingsSpy).toHaveBeenCalledWith(expect.objectContaining({ showInMenuBar: false }))
  })

  it('leaves the tray setting alone when kept on', async () => {
    const updateSettingsSpy = vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings')
    await openThinkingStep()
    pickApproach('Decide later')
    clickButton(/Next/)
    clickButton(/Next/)
    clickButton('Explore graphrt')
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(updateSettingsSpy).not.toHaveBeenCalled()
  })

  it('keeps answers when going Back', async () => {
    await openThinkingStep()
    pickApproach('Use my company’s API key')
    clickButton(/Next/)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: anthropicKey } })
    clickButton(/Back/)
    expect(screen.getByRole('radio', { name: 'Use my company’s API key' })).toBeChecked()
    clickButton(/Next/)
    expect(screen.getByLabelText('API key')).toHaveValue(anthropicKey)
  })

  it('stays on Done and explains a failed save', async () => {
    vi.spyOn(sampleCredentialsBackend, 'setApiKey').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    const setWelcomeChoiceSpy = vi.spyOn(sampleCredentialsBackend, 'setWelcomeChoice')
    await openThinkingStep()
    pickApproach('Use my company’s API key')
    clickButton(/Next/)
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: anthropicKey } })
    goFromConnectToDone()
    clickButton('Build my first agent')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your setup: Keychain is locked')
    expect(screen.getByRole('button', { name: 'Build my first agent' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Back/ })).toBeEnabled()
    expect(screen.queryByText('New agent screen')).not.toBeInTheDocument()
    expect(setWelcomeChoiceSpy).not.toHaveBeenCalled()
  })
})
