import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { jobDescriptionPlaceholder } from '@/data/newAgentTemplates'
import { routePaths } from '@/routes'
import { NewAgentPage } from '../NewAgentPage'

/** Stand-in for screen 03 that shows the router state it received. */
function GeneratingStandIn() {
  const location = useLocation()
  return <p>Generating screen {JSON.stringify(location.state)}</p>
}

function ChatbotSetupStandIn() {
  const location = useLocation()
  return <p>Chatbot setup screen {JSON.stringify(location.state)}</p>
}

function renderNewAgentPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.newAgent]}>
      <Routes>
        <Route path={routePaths.newAgent} element={<NewAgentPage />} />
        <Route path={routePaths.generating} element={<GeneratingStandIn />} />
        <Route path={routePaths.chatbotSetup} element={<ChatbotSetupStandIn />} />
        <Route path={routePaths.connections} element={<p>Connections screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NewAgentPage', () => {
  beforeEach(() => resetSampleCredentials())
  afterEach(() => vi.restoreAllMocks())

  it('starts with an empty prompt, the example as placeholder, kind pills and templates', async () => {
    renderNewAgentPage()
    expect(screen.getByRole('heading', { name: 'What should your agent do?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Do a task' })).toBeChecked()
    const prompt = screen.getByLabelText('Describe the job')
    expect(prompt).toHaveValue('')
    expect(prompt).toHaveAttribute('placeholder', jobDescriptionPlaceholder)
    expect(screen.getByRole('button', { name: 'Build agent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Customer chatbot/ })).toBeInTheDocument()
    expect(screen.getByText('Runs on this Mac')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('gpt-4o-mini · OpenAI')
  })

  it('shows the real default model on the chip', async () => {
    vi.spyOn(sampleCredentialsBackend, 'getDefaultModel').mockResolvedValue({ provider: 'deepseek', name: 'deepseek-chat' })
    renderNewAgentPage()
    expect(screen.getByText('Checking model…')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('deepseek-chat · DeepSeek')
  })

  it('lets the user switch the model to another provider with a key', async () => {
    await sampleCredentialsBackend.setApiKey('deepseek', 'sk-deepseek')
    await sampleCredentialsBackend.setDefaultModel({ provider: 'deepseek', name: 'deepseek-chat' })
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderNewAgentPage()

    const picker = await screen.findByRole('combobox', { name: 'Model for new agents' })
    await waitFor(() => expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['deepseek-chat · DeepSeek', 'gpt-4o-mini · OpenAI']))
    fireEvent.change(picker, { target: { value: 'openai:gpt-4o-mini' } })

    await waitFor(() => expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'openai', name: 'gpt-4o-mini' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('gpt-4o-mini · OpenAI'))
  })

  it('links the chip to Connections when no model is connected', async () => {
    vi.spyOn(sampleCredentialsBackend, 'getDefaultModel').mockRejectedValue(new BackendError('missing_credentials', 'a model provider'))
    renderNewAgentPage()
    fireEvent.click(await screen.findByRole('link', { name: 'Connect a model' }))
    expect(screen.getByText('Connections screen')).toBeInTheDocument()
  })

  it('fills the prompt and kind from a template without building anything', () => {
    renderNewAgentPage()
    const prompt = screen.getByLabelText('Describe the job')
    fireEvent.click(screen.getByRole('button', { name: /Customer chatbot/ }))
    expect(prompt).toHaveValue('Answer WhatsApp questions from your menu and price list, pass orders to you')
    expect(screen.getByRole('radio', { name: 'Answer customers' })).toBeChecked()
    expect(prompt).toHaveFocus()
    expect(screen.queryByText(/Chatbot setup screen/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Invoice reminders/ }))
    expect(prompt).toHaveValue('Find unpaid rows in a sheet and email a polite reminder')
    expect(screen.getByRole('radio', { name: 'Do a task' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(/Generating screen/)).toHaveTextContent(
      JSON.stringify({ buildRequest: { description: 'Find unpaid rows in a sheet and email a polite reminder', kind: 'task' } }),
    )
  })

  it('builds a task agent by passing the request to the generating screen', () => {
    renderNewAgentPage()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: '  Send invoice reminders  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(/Generating screen/)).toHaveTextContent(JSON.stringify({ buildRequest: { description: 'Send invoice reminders', kind: 'task' } }))
  })

  it('sends "Answer customers" to chatbot setup and needs a description', () => {
    renderNewAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Answer customers' }))
    expect(screen.getByRole('radio', { name: 'Answer customers' })).toBeChecked()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Build agent' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: 'Answer menu questions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(/Chatbot setup screen/)).toBeInTheDocument()
  })
})
