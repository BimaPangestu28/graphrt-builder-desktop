import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackendError } from '@/api/client'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import type { ModelChoice, OllamaCheck, OllamaState } from '@/api/types'
import { buildModelConnections } from './modelConnections'
import { describeOllamaStatus, OllamaCard, pickOllamaModel } from './OllamaCard'

const baseUrl = 'http://localhost:11434'

function ollamaCheck(state: OllamaState, models: string[] = []): OllamaCheck {
  return { state, baseUrl, models }
}

function renderOllamaCard(defaultModel: ModelChoice | null = null) {
  const [connection] = buildModelConnections([{ provider: 'ollama', configured: true, baseUrl, localCli: null }], defaultModel)
  const onChanged = vi.fn(async () => {})
  render(<OllamaCard connection={connection} defaultModel={defaultModel} onChanged={onChanged} />)
  return { onChanged }
}

describe('describeOllamaStatus', () => {
  it('says Checking until the answer is in, never "found"', () => {
    expect(describeOllamaStatus(null, null)).toMatchObject({ label: 'Checking…', isUsable: false, offersDownload: false })
  })

  it('tells running, no model yet, not running and not found apart', () => {
    expect(describeOllamaStatus(ollamaCheck('running', ['llama3.2:latest']), null)).toMatchObject({ label: 'Running', tone: 'ok', isUsable: true })
    expect(describeOllamaStatus(ollamaCheck('running'), null)).toMatchObject({ label: 'No model yet', tone: 'amber', isUsable: false })
    expect(describeOllamaStatus(ollamaCheck('installed_not_running'), null)).toMatchObject({ label: 'Not running', tone: 'amber', isUsable: false })
    expect(describeOllamaStatus(ollamaCheck('not_found'), null)).toMatchObject({ label: 'Not found', isUsable: false, offersDownload: true })
  })

  it('reports a failed check as such, not as a missing Ollama', () => {
    const status = describeOllamaStatus(null, new BackendError('internal', 'a background task failed'))
    expect(status).toMatchObject({ label: 'Could not check', detail: 'Could not check Ollama: a background task failed', offersDownload: false })
  })
})

describe('pickOllamaModel', () => {
  it('takes the first model, which the check lists largest first', () => {
    expect(pickOllamaModel(['qwen2.5:14b', 'llama3.2:latest'])).toEqual({ provider: 'ollama', name: 'qwen2.5:14b' })
    expect(pickOllamaModel(['llama3.2'])).toEqual({ provider: 'ollama', name: 'llama3.2' })
  })

  it('falls back to the model the app tells people to download', () => {
    expect(pickOllamaModel([])).toEqual({ provider: 'ollama', name: 'llama3.2' })
  })
})

describe('OllamaCard', () => {
  beforeEach(() => {
    resetSampleCredentials()
  })

  it('shows Checking first, then that Ollama runs, and offers it as the default', async () => {
    vi.spyOn(sampleCredentialsBackend, 'checkOllama').mockResolvedValue(ollamaCheck('running', ['qwen2.5:14b']))
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    const { onChanged } = renderOllamaCard()
    expect(screen.getByText('Checking if Ollama is running on this computer…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Ollama by default' })).not.toBeInTheDocument()

    expect(await screen.findByText('Running on this computer, 1 model ready to use')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use Ollama by default' }))
    await waitFor(() => expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'ollama', name: 'qwen2.5:14b' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('says to open the app when Ollama is installed but not running, and does not offer it as the default', async () => {
    vi.spyOn(sampleCredentialsBackend, 'checkOllama').mockResolvedValue(ollamaCheck('installed_not_running'))
    renderOllamaCard()
    expect(await screen.findByText('Ollama is installed, but it is not running. Open the Ollama app, then check again')).toBeInTheDocument()
    expect(screen.getByText('Not running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Ollama by default' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download Ollama' })).not.toBeInTheDocument()
  })

  it('offers the download when Ollama was not found', async () => {
    vi.spyOn(sampleCredentialsBackend, 'checkOllama').mockResolvedValue(ollamaCheck('not_found'))
    renderOllamaCard()
    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download Ollama' })).toHaveAttribute('href', 'https://ollama.com/download')
    expect(screen.queryByText('Found on this computer')).not.toBeInTheDocument()
  })

  it('asks for a model when Ollama runs without one', async () => {
    vi.spyOn(sampleCredentialsBackend, 'checkOllama').mockResolvedValue(ollamaCheck('running'))
    renderOllamaCard()
    expect(await screen.findByText('No model yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Ollama by default' })).not.toBeInTheDocument()
  })

  it('checks again on request and shows the new answer', async () => {
    const checkSpy = vi
      .spyOn(sampleCredentialsBackend, 'checkOllama')
      .mockResolvedValueOnce(ollamaCheck('installed_not_running'))
      .mockResolvedValueOnce(ollamaCheck('running', ['llama3.2:latest', 'qwen2.5:14b']))
    renderOllamaCard()
    expect(await screen.findByText('Not running')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check Ollama again' }))
    expect(await screen.findByText('Running on this computer, 2 models ready to use')).toBeInTheDocument()
    expect(checkSpy).toHaveBeenCalledTimes(2)
  })

  it('still says when the default Ollama is not running', async () => {
    vi.spyOn(sampleCredentialsBackend, 'checkOllama').mockResolvedValue(ollamaCheck('installed_not_running'))
    renderOllamaCard({ provider: 'ollama', name: 'llama3.2' })
    expect(await screen.findByText('Not running')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('New agents use llama3.2')).toBeInTheDocument()
  })
})
