import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleConversations } from '@/api/sampleBackend/conversations'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { sampleRunSummaryBackend } from '@/api/sampleBackend/runSummary'
import { resetSampleTriggers } from '@/api/sampleBackend/triggers'
import { gettingStartedDismissedKey } from '@/pages/home-dashboard/gettingStarted'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'
import { HomePage } from '@/pages/HomePage'
import { agentPath, agentRoutePatterns, routePaths, runReviewPath } from '@/routes'

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
        <Route path={agentRoutePatterns.testRun} element={<p>Test run screen</p>} />
        <Route path={routePaths.batchApproval} element={<p>Review screen</p>} />
        <Route path={routePaths.runs} element={<p>Runs screen</p>} />
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
    window.localStorage.removeItem(gettingStartedDismissedKey)
  })
  afterEach(() => vi.restoreAllMocks())

  it('lists everything that needs the user, most urgent first', async () => {
    renderHomePage()
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    const needsYou = screen.getByRole('region', { name: /Needs you/ })
    expect(within(needsYou).getByText('Checking what needs you…')).toBeInTheDocument()
    expect(await within(needsYou).findByText('Catering assistant is waiting for you')).toBeInTheDocument()
    expect(await within(needsYou).findByText('3 customers are waiting in Inbox')).toBeInTheDocument()
    expect(await within(needsYou).findByText("Maps leads to WhatsApp isn't ready to run")).toBeInTheDocument()
    // One row per agent: its connection problem and its plugin setup together.
    const mapsRow = within(needsYou).getByText("Maps leads to WhatsApp isn't ready to run").closest('li')
    expect(mapsRow).toHaveTextContent('WhatsApp was logged out')
    expect(mapsRow).toHaveTextContent("whatsapp-api isn't installed")
    expect(within(needsYou).getByText('Gmail sign-in expired')).toBeInTheDocument()
    const titles = within(needsYou)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.font-semibold')?.textContent)
    expect(titles[0]).toBe('Catering assistant is waiting for you')
    expect(titles[1]).toBe('3 customers are waiting in Inbox')
    expect(within(needsYou).getAllByRole('link', { name: 'Set up' })[0]).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
    expect(await screen.findByText(/^5 things need you · next run (today|tomorrow|\w{3} \d+ \w{3}) \d\d:\d\d$/)).toBeInTheDocument()
  })

  it('opens a paused run from "Review"', async () => {
    renderHomePage()
    const reviewLink = await screen.findByRole('link', { name: 'Review' })
    // A run that is not a test run is answered on the review screen.
    expect(reviewLink).toHaveAttribute('href', runReviewPath('catering-assistant-0852'))
    fireEvent.click(reviewLink)
    expect(screen.getByText('Review screen')).toBeInTheDocument()
  })

  it('gives each agent card a status chip and one next step', async () => {
    const listAgentsSpy = vi.spyOn(sampleAgentsBackend, 'listAgents')
    const listStatsSpy = vi.spyOn(sampleRunSummaryBackend, 'listAgentRunStats')
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    expect(within(agentsSection).getByText('Loading agents…')).toBeInTheDocument()
    const mapsCard = await within(agentsSection).findByRole('article', { name: 'Maps leads to WhatsApp' })
    expect(within(mapsCard).getByText(/^Active · next run /)).toBeInTheDocument()
    expect(within(mapsCard).getByRole('button', { name: 'Run now' })).toBeInTheDocument()
    expect(within(mapsCard).getByRole('link', { name: 'Edit steps' })).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
    expect(await within(mapsCard).findByText(/12 messages sent this week/)).toBeInTheDocument()
    const invoiceCard = within(agentsSection).getByRole('article', { name: 'Invoice reminders' })
    expect(within(invoiceCard).getByText('Paused')).toBeInTheDocument()
    expect(within(invoiceCard).getByRole('link', { name: 'Resume' })).toHaveAttribute('href', agentPath('scheduleAgent', 'invoice-reminders'))
    const chatbotCard = within(agentsSection).getByRole('article', { name: 'Catering assistant' })
    expect(within(chatbotCard).getByRole('link', { name: 'Open Inbox' })).toHaveAttribute('href', routePaths.inbox)
    const description = within(chatbotCard).getByText('Answer WhatsApp questions from our menu and price list, and pass orders to me')
    expect(description).toHaveAttribute('title', 'Answer WhatsApp questions from our menu and price list, and pass orders to me')
    expect(listAgentsSpy).toHaveBeenCalled()
    expect(listStatsSpy).toHaveBeenCalled()
  })

  it('starts a manual run with the last inputs from "Run now"', async () => {
    const startRunSpy = vi.spyOn(sampleRunsBackend, 'startRun')
    renderHomePage()
    const mapsCard = await screen.findByRole('article', { name: 'Maps leads to WhatsApp' })
    fireEvent.click(within(mapsCard).getByRole('button', { name: 'Run now' }))
    expect(await within(mapsCard).findByText('Run started')).toBeInTheDocument()
    expect(startRunSpy).toHaveBeenCalledWith('maps-leads', 'manual', expect.objectContaining({ keyword: expect.any(String) }))
  })

  it('shows the getting started checklist until it is hidden', async () => {
    renderHomePage()
    const checklist = await screen.findByRole('region', { name: /Getting started/ })
    expect(within(checklist).getByText('4 of 5 done')).toBeInTheDocument()
    expect(within(checklist).getByRole('link', { name: 'Set up its plugins' })).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
    fireEvent.click(within(checklist).getByRole('button', { name: 'Hide getting started' }))
    expect(screen.queryByRole('region', { name: /Getting started/ })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(gettingStartedDismissedKey)).toBe('true')
  })

  it('lists recent runs in plain words and opens a run from its row', async () => {
    renderHomePage()
    const recentRunsSection = screen.getByRole('region', { name: 'Recent runs' })
    expect(within(recentRunsSection).getByText('Loading runs…')).toBeInTheDocument()
    const recentRunsTable = await within(recentRunsSection).findByRole('table')
    expect(within(recentRunsTable).getAllByRole('row')).toHaveLength(6)
    expect(within(recentRunsTable).getByText('11 sent · 1 skipped')).toBeInTheDocument()
    expect(within(recentRunsTable).getByText('Needs you')).toBeInTheDocument()
    expect(within(recentRunsTable).getAllByRole('link', { name: 'Maps leads to WhatsApp' })[0]).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
    fireEvent.click(within(recentRunsTable).getByText('11 sent · 1 skipped').closest('tr') as HTMLElement)
    expect(screen.getByText('Runs screen')).toBeInTheDocument()
  })

  it('shows this month\'s results and AI tokens, without filler', async () => {
    renderHomePage()
    const thisMonth = screen.getByRole('region', { name: 'This month' })
    expect(await within(thisMonth).findByText('Runs succeeded')).toBeInTheDocument()
    expect(within(thisMonth).getByText('Runs failed')).toBeInTheDocument()
    expect(await within(thisMonth).findByText('412K')).toBeInTheDocument()
    expect(within(thisMonth).queryByText(/cost|Time saved|Free and open source|own server/)).not.toBeInTheDocument()
  })

  it('shows quiet messages when agents or runs cannot be loaded', async () => {
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockRejectedValue(new BackendError('database', 'database is locked'))
    vi.spyOn(sampleRunsBackend, 'listRuns').mockRejectedValue(new BackendError('database', 'runs are locked'))
    renderHomePage()
    expect(await screen.findByText('Could not load your agents: database is locked')).toBeInTheDocument()
    expect(await screen.findByText('Could not check what needs you: runs are locked')).toBeInTheDocument()
    expect(screen.getByText('Could not load recent runs: runs are locked')).toBeInTheDocument()
  })

  it('picks a greeting for the time of day', () => {
    expect(getGreetingForHour(8)).toBe('Good morning')
    expect(getGreetingForHour(14)).toBe('Good afternoon')
    expect(getGreetingForHour(21)).toBe('Good evening')
  })

  it('renames an agent from its card menu', async () => {
    const renameSpy = vi.spyOn(sampleAgentsBackend, 'renameAgent')
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    const mapsCard = await within(agentsSection).findByRole('article', { name: 'Maps leads to WhatsApp' })

    fireEvent.click(within(mapsCard).getByRole('button', { name: 'More actions for Maps leads to WhatsApp' }))
    const menu = within(mapsCard).getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(within(mapsCard).getByLabelText('Agent name'), { target: { value: 'Bandar Lampung leads' } })
    fireEvent.click(within(mapsCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameSpy).toHaveBeenCalledWith('maps-leads', 'Bandar Lampung leads'))
    expect(await within(agentsSection).findByRole('article', { name: 'Bandar Lampung leads' })).toBeInTheDocument()
  })

  it('deletes an agent from its card menu after asking', async () => {
    const deleteSpy = vi.spyOn(sampleAgentsBackend, 'deleteAgent')
    renderHomePage()
    const agentsSection = screen.getByRole('region', { name: 'Agents' })
    const invoiceCard = await within(agentsSection).findByRole('article', { name: 'Invoice reminders' })

    fireEvent.click(within(invoiceCard).getByRole('button', { name: 'More actions for Invoice reminders' }))
    fireEvent.click(within(invoiceCard).getByRole('menuitem', { name: 'Delete' }))
    expect(within(invoiceCard).getByRole('alertdialog')).toHaveTextContent('Delete “Invoice reminders”?')
    expect(deleteSpy).not.toHaveBeenCalled()
    fireEvent.click(within(invoiceCard).getByRole('button', { name: 'Delete agent' }))

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('invoice-reminders'))
    await waitFor(() => expect(within(agentsSection).queryByRole('article', { name: 'Invoice reminders' })).not.toBeInTheDocument())
  })

  it('closes the card menu with Escape', async () => {
    renderHomePage()
    const mapsCard = await within(screen.getByRole('region', { name: 'Agents' })).findByRole('article', { name: 'Maps leads to WhatsApp' })
    const menuButton = within(mapsCard).getByRole('button', { name: 'More actions for Maps leads to WhatsApp' })
    fireEvent.click(menuButton)
    fireEvent.keyDown(within(mapsCard).getByRole('menu'), { key: 'Escape' })
    expect(within(mapsCard).queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()
  })
})
