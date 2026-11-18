import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { sampleRunSummaryBackend } from '@/api/sampleBackend/runSummary'
import { resetSampleConversations } from '@/api/sampleBackend/conversations'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { resetSampleTriggers } from '@/api/sampleBackend/triggers'
import { agentPath, agentRoutePatterns, routePaths, runReviewPath } from '@/routes'
import { HomePage } from '@/pages/HomePage'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
        <Route path={agentRoutePatterns.testRun} element={<p>Test run screen</p>} />
        <Route path={routePaths.batchApproval} element={<p>Review screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleRuns()
    resetSampleConversations()
    resetSampleTriggers()
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
    expect(await within(needsYou).findByText('Gmail sign-in expired')).toBeInTheDocument()
    expect(await within(needsYou).findByText('3 customers are waiting in Inbox')).toBeInTheDocument()
    expect(await screen.findByText(/^4 things need you · next run (today|tomorrow|\w{3} \d+ \w{3}) \d\d:\d\d$/)).toBeInTheDocument()
  })

  it('opens a paused run from "Review"', async () => {
    renderHomePage()
    const reviewLink = await screen.findByRole('link', { name: 'Review' })
    // A run that is not a test run is answered on the review screen.
    expect(reviewLink).toHaveAttribute('href', runReviewPath('catering-assistant-0852'))
    fireEvent.click(reviewLink)
    expect(screen.getByText('Review screen')).toBeInTheDocument()
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
  })

  it('shows this month\'s runs and AI tokens from the sample backend, with no invented cost', async () => {
    renderHomePage()
    const thisMonth = screen.getByRole('region', { name: 'This month' })
    expect(await within(thisMonth).findByText('64')).toBeInTheDocument()
    expect(within(thisMonth).getByText('AI tokens')).toBeInTheDocument()
    expect(within(thisMonth).getByText('412K')).toBeInTheDocument()
    expect(within(thisMonth).queryByText(/cost|Time saved/)).not.toBeInTheDocument()
  })

  it('shows each agent\'s schedule from its triggers', async () => {
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    expect(await within(agentsSection).findByText('Weekdays 09:00')).toBeInTheDocument()
    expect(within(agentsSection).getByText('Every day 07:00')).toBeInTheDocument()
    expect(within(agentsSection).getByText('Schedule off · Mondays 10:00')).toBeInTheDocument()
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
