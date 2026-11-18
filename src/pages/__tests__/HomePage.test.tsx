import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { sampleRunSummaryBackend } from '@/api/sampleBackend/runSummary'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { agentPath, agentRoutePatterns, routePaths } from '@/routes'
import { HomePage } from '@/pages/HomePage'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
        <Route path={agentRoutePatterns.testRun} element={<p>Test run screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleRuns()
  })
  afterEach(() => vi.restoreAllMocks())

  it('greets the user and lists paused runs plus the preview reminders', async () => {
    renderHomePage()
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    expect(within(needsYou).getByText('Checking what needs you…')).toBeInTheDocument()
    expect(await within(needsYou).findByText('Catering assistant is waiting for you')).toBeInTheDocument()
    expect(within(needsYou).getByText(/An order for 40 nasi box is waiting for your confirmation/)).toBeInTheDocument()
    expect(within(needsYou).getByText('Gmail sign-in expired')).toBeInTheDocument()
    expect(screen.getByText('3 things need you · next run tomorrow 07:00')).toBeInTheDocument()
  })

  it('opens a paused run from "Review"', async () => {
    renderHomePage()
    const reviewLink = await screen.findByRole('link', { name: 'Review' })
    expect(reviewLink).toHaveAttribute('href', agentPath('testRun', 'catering-assistant', { runId: 'catering-assistant-0852' }))
    fireEvent.click(reviewLink)
    expect(screen.getByText('Test run screen')).toBeInTheDocument()
  })

  it('says when nothing needs the user', async () => {
    vi.spyOn(sampleRunsBackend, 'listRuns').mockResolvedValue([])
    renderHomePage()
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    // The preview reminders still show; no paused runs are listed.
    expect(await within(needsYou).findByText('Gmail sign-in expired')).toBeInTheDocument()
    expect(within(needsYou).queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    expect(await screen.findByText('No runs yet. Test an agent to see it here')).toBeInTheDocument()
  })

  it('loads agent cards with this week\'s run stats', async () => {
    const listAgentsSpy = vi.spyOn(sampleAgentsBackend, 'listAgents')
    const listStatsSpy = vi.spyOn(sampleRunSummaryBackend, 'listAgentRunStats')
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    expect(within(agentsSection).getByText('Loading agents…')).toBeInTheDocument()
    const invoiceCard = await within(agentsSection).findByRole('link', { name: /Invoice reminders/ })
    expect(invoiceCard).toHaveTextContent('Paused')
    expect(invoiceCard).toHaveAttribute('href', agentPath('builder', 'invoice-reminders'))
    const mapsCard = within(agentsSection).getByRole('link', { name: /^Maps leads to WhatsApp/ })
    expect(await within(mapsCard).findByText(/messages sent this week/)).toBeInTheDocument()
    expect(mapsCard).toHaveTextContent('12 messages sent this week')
    expect(mapsCard).toHaveTextContent(/Last run ok · (Today|Yesterday) \d\d:\d\d/)
    expect(within(agentsSection).getByRole('link', { name: /Morning email digest/ })).toHaveTextContent('8 emails summarized this week')
    expect(invoiceCard).toHaveTextContent('No runs yet')
    expect(within(agentsSection).getByRole('link', { name: /Catering assistant/ })).toHaveTextContent('Chatbot')
    expect(listAgentsSpy).toHaveBeenCalled()
    expect(listStatsSpy).toHaveBeenCalled()
  })

  it('lists recent runs with their summary headline', async () => {
    renderHomePage()
    const recentRunsSection = screen.getByRole('region', { name: 'Recent runs' })
    expect(within(recentRunsSection).getByText('Loading runs…')).toBeInTheDocument()
    const recentRunsTable = await within(recentRunsSection).findByRole('table')
    expect(within(recentRunsTable).getAllByRole('row')).toHaveLength(6)
    expect(within(recentRunsTable).getByText('11 sent · 1 skipped')).toBeInTheDocument()
    expect(within(recentRunsTable).getByText('Needs you')).toBeInTheDocument()
    expect(screen.getByText('$0.38')).toBeInTheDocument()
  })

  it('shows quiet messages when agents or runs cannot be loaded', async () => {
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockRejectedValue(new BackendError('database', 'database is locked'))
    vi.spyOn(sampleRunsBackend, 'listRuns').mockRejectedValue(new BackendError('database', 'runs are locked'))
    renderHomePage()
    expect(await screen.findByText('Could not load your agents: database is locked')).toBeInTheDocument()
    expect(await screen.findByText('Could not check for paused runs: runs are locked')).toBeInTheDocument()
    expect(screen.getByText('Could not load recent runs: runs are locked')).toBeInTheDocument()
  })

  it('picks a greeting for the time of day', () => {
    expect(getGreetingForHour(8)).toBe('Good morning')
    expect(getGreetingForHour(14)).toBe('Good afternoon')
    expect(getGreetingForHour(21)).toBe('Good evening')
  })
})
