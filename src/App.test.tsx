import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { deleteApiKey, setDefaultModel } from '@/api/credentials'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { App } from './App'
import { routePaths } from './routes'

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>
}

function renderAppAtRoot() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CurrentPath />
      <App />
    </MemoryRouter>,
  )
}

describe('App start route', () => {
  beforeEach(() => resetSampleCredentials())

  it('opens Home when a provider key is stored', async () => {
    renderAppAtRoot()
    expect(await screen.findByText(routePaths.home)).toBeInTheDocument()
  })

  it('opens Welcome on first launch, when no provider is configured', async () => {
    await deleteApiKey('openai')
    renderAppAtRoot()
    expect(await screen.findByText(routePaths.welcome)).toBeInTheDocument()
  })

  it('counts Ollama only when it is the default model', async () => {
    await deleteApiKey('openai')
    await setDefaultModel({ provider: 'ollama', name: 'llama3.2' })
    renderAppAtRoot()
    expect(await screen.findByText(routePaths.home)).toBeInTheDocument()
  })
})
