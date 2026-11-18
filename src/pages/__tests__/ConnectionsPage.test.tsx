import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { ConnectionsPage } from '../ConnectionsPage'

function renderConnectionsPage() {
  return render(
    <MemoryRouter>
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
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows apps, AI models and the Gmail sign-in warning', async () => {
    renderConnectionsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument()
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

  it('reconnects Gmail from the banner', () => {
    renderConnectionsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }))
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
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'ollama' } })
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'zzz' } })
    expect(screen.getByText(/No connections match/)).toBeInTheDocument()
  })
})
