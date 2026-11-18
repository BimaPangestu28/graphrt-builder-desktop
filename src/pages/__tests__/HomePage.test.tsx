import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { agentPath, routePaths } from '@/routes'
import { HomePage } from '@/pages/HomePage'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
        <Route path={routePaths.batchApproval} element={<p>Batch approval screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => resetSampleAgents())
  afterEach(() => vi.restoreAllMocks())

  it('greets the user and lists what needs them', async () => {
    renderHomePage()
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument()
    expect(screen.getByText('3 things need you · next run tomorrow 07:00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await screen.findAllByRole('link', { name: /Invoice reminders/ })
  })

  it('loads agent cards from the API next to recent runs and monthly usage', async () => {
    const listAgentsSpy = vi.spyOn(sampleAgentsBackend, 'listAgents')
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    expect(within(agentsSection).getByText('Loading agents…')).toBeInTheDocument()
    const invoiceCard = await within(agentsSection).findByRole('link', { name: /Invoice reminders/ })
    expect(invoiceCard).toHaveTextContent('Paused')
    expect(invoiceCard).toHaveAttribute('href', agentPath('builder', 'invoice-reminders'))
    expect(within(agentsSection).getByRole('link', { name: /^Maps leads to WhatsApp/ })).toHaveTextContent('47 sent this week')
    expect(within(agentsSection).getByRole('link', { name: /Catering assistant/ })).toHaveTextContent('Chatbot')
    expect(listAgentsSpy).toHaveBeenCalled()
    const recentRunsTable = screen.getByRole('table')
    expect(within(recentRunsTable).getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('$0.38')).toBeInTheDocument()
  })

  it('shows a quiet message when agents cannot be loaded', async () => {
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockRejectedValue(new BackendError('database', 'database is locked'))
    renderHomePage()
    expect(await screen.findByText('Could not load your agents: database is locked')).toBeInTheDocument()
  })

  it('opens the batch review from "Review messages"', () => {
    renderHomePage()
    fireEvent.click(screen.getByRole('link', { name: 'Review messages' }))
    expect(screen.getByText('Batch approval screen')).toBeInTheDocument()
  })

  it('picks a greeting for the time of day', () => {
    expect(getGreetingForHour(8)).toBe('Good morning')
    expect(getGreetingForHour(14)).toBe('Good afternoon')
    expect(getGreetingForHour(21)).toBe('Good evening')
  })
})
