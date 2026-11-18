import { fireEvent, render, screen } from '@testing-library/react'
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
      </Routes>
    </MemoryRouter>,
  )
}

function typeApiKey(apiKey: string) {
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: apiKey } })
}

describe('WelcomePage', () => {
  beforeEach(() => resetSampleCredentials())
  afterEach(() => vi.restoreAllMocks())

  it('shows the onboarding heading with the credits option disabled', () => {
    renderWelcomePage()
    expect(screen.getByRole('heading', { name: 'Agents that run on your Mac' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /graphrt credits/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /My own API key/ })).toBeChecked()
  })

  it('blocks Continue without a key, except for a local Ollama model', () => {
    renderWelcomePage()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    typeApiKey('sk-test')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    typeApiKey('')
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'Ollama (local)' } })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('saves the key and default model, then goes to the new agent screen', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep agents running/ }))
    expect(screen.getByRole('checkbox', { name: /Keep agents running/ })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'Anthropic' } })
    typeApiKey('  sk-ant-test  ')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('anthropic', 'sk-ant-test')
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'anthropic', name: 'claude-haiku-5-5' })
  })

  it('saves a DeepSeek key with deepseek-chat as the default model', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderWelcomePage()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'DeepSeek' } })
    typeApiKey('sk-deepseek-test')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('deepseek', 'sk-deepseek-test')
    expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'deepseek', name: 'deepseek-chat' })
  })

  it('saves the Ollama address instead of a key for a local model', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const setOllamaBaseUrlSpy = vi.spyOn(sampleCredentialsBackend, 'setOllamaBaseUrl')
    renderWelcomePage()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'Ollama (local)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('New agent screen')).toBeInTheDocument()
    expect(setOllamaBaseUrlSpy).toHaveBeenCalledWith('http://localhost:11434')
    expect(setApiKeySpy).not.toHaveBeenCalled()
  })

  it('stays on the screen and explains a failed save', async () => {
    vi.spyOn(sampleCredentialsBackend, 'setApiKey').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    renderWelcomePage()
    typeApiKey('sk-test')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your AI setup: Keychain is locked')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(screen.queryByText('New agent screen')).not.toBeInTheDocument()
  })
})
