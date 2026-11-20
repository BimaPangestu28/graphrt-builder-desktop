import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import mapsWhatsAppTemplate from '@/data/mapsWhatsAppTemplate.json'
import { agentTemplates, jobDescriptionPlaceholder, newAgentTemplatePath } from '@/data/newAgentTemplates'
import { connectionsTabPath, routePaths } from '@/routes'
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

const mapsWhatsAppTitle = 'Find businesses on Maps and message them on WhatsApp'

function renderNewAgentPage(initialEntry: string = routePaths.newAgent) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePaths.newAgent} element={<NewAgentPage />} />
        <Route path={routePaths.generating} element={<GeneratingStandIn />} />
        <Route path={routePaths.chatbotSetup} element={<ChatbotSetupStandIn />} />
        <Route path={connectionsTabPath('models')} element={<p>Connections screen</p>} />
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
    expect(screen.getByText('Runs on this computer')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('gpt-4o-mini')
  })

  it('shows the real default model on the chip', async () => {
    vi.spyOn(sampleCredentialsBackend, 'getDefaultModel').mockResolvedValue({ provider: 'deepseek', name: 'deepseek-chat' })
    renderNewAgentPage()
    expect(screen.getByText('Checking model…')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('deepseek-chat')
  })

  it('lists every model of each connected provider and switches between them', async () => {
    await sampleCredentialsBackend.setApiKey('deepseek', 'sk-deepseek')
    await sampleCredentialsBackend.setDefaultModel({ provider: 'deepseek', name: 'deepseek-chat' })
    const setDefaultModelSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    renderNewAgentPage()

    const picker = await screen.findByRole('combobox', { name: 'Model for new agents' })
    await waitFor(() => expect(within(picker).getAllByRole('group').map((group) => group.getAttribute('label'))).toEqual(['DeepSeek', 'OpenAI', 'Ollama']))
    const openAiGroup = within(picker).getAllByRole('group')[1]
    expect(within(openAiGroup).getAllByRole('option').map((option) => option.textContent)).toEqual(['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'])
    fireEvent.change(picker, { target: { value: 'openai:gpt-4.1' } })

    await waitFor(() => expect(setDefaultModelSpy).toHaveBeenCalledWith({ provider: 'openai', name: 'gpt-4.1' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model for new agents' })).toHaveDisplayValue('gpt-4.1'))
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

  it('lists the Maps → WhatsApp template first, with what it needs', () => {
    renderNewAgentPage()
    const gallery = screen.getByRole('region', { name: 'Templates' })
    const cards = within(gallery).getAllByRole('button')
    expect(cards).toHaveLength(agentTemplates.length)
    expect(cards[0]).toHaveAccessibleName(expect.stringContaining(mapsWhatsAppTitle))
    expect(within(cards[0]).getByText('Google Maps scraper')).toBeInTheDocument()
    expect(within(cards[0]).getByText('WhatsApp (personal)')).toBeInTheDocument()
    expect(within(cards[0]).getByText(/You'll need: WhatsApp linked by QR/)).toBeInTheDocument()
    expect(within(cards[0]).getByText('Google Maps · WhatsApp · Approval')).toBeInTheDocument()
  })

  it('gives every template need chips and a setup note', () => {
    renderNewAgentPage()
    for (const card of within(screen.getByRole('region', { name: 'Templates' })).getAllByRole('button')) {
      expect(within(card).getByText(/^You'll need: /)).toBeInTheDocument()
    }
    expect(agentTemplates.every((template) => template.needs.length > 0)).toBe(true)
  })

  it('fills the editable prompt with the full Maps → WhatsApp brief and keeps the task kind', () => {
    renderNewAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Agent team' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(mapsWhatsAppTitle) }))
    const prompt = screen.getByLabelText('Describe the job')
    expect(prompt).toHaveValue(mapsWhatsAppTemplate.prompt)
    expect(screen.getByRole('radio', { name: 'Do a task' })).toBeChecked()

    fireEvent.change(prompt, { target: { value: `${mapsWhatsAppTemplate.prompt} Only on weekdays.` } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(/Generating screen/)).toHaveTextContent('Only on weekdays.')
  })

  it('asks for the steps the builder needs in the Maps → WhatsApp brief', () => {
    for (const phrase of ['google-maps-scraper', 'whatsapp-web', 'Ask me before sending', 'no spam', 'run report', 'never more than 20']) {
      expect(mapsWhatsAppTemplate.prompt).toContain(phrase)
    }
  })

  it('opens with a template picked from ?template=', () => {
    renderNewAgentPage(newAgentTemplatePath('maps-whatsapp'))
    expect(screen.getByLabelText('Describe the job')).toHaveValue(mapsWhatsAppTemplate.prompt)
    expect(screen.getByRole('radio', { name: 'Do a task' })).toBeChecked()
  })

  it('ignores an unknown ?template=', () => {
    renderNewAgentPage(newAgentTemplatePath('no-such-template'))
    expect(screen.getByLabelText('Describe the job')).toHaveValue('')
  })
})
