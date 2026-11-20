import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { agentPath, routePaths } from '@/routes'
import { Sidebar } from './Sidebar'

function renderSidebar(props: Parameters<typeof Sidebar>[0]) {
  return render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  beforeEach(() => resetSampleAgents())
  afterEach(() => vi.restoreAllMocks())

  it('marks the active nav item as the current page', async () => {
    renderSidebar({ activeNav: 'runs' })
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    await screen.findByRole('link', { name: /Maps leads to WhatsApp/ })
  })

  it('shows the empty message before any agent exists', () => {
    renderSidebar({ agents: { kind: 'empty' } })
    expect(screen.getByText('No agents yet. Your first one will show up here')).toBeInTheDocument()
  })

  it('shows a highlighted draft agent with its status', () => {
    renderSidebar({ agents: { kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Draft · not tested yet', agentId: 'abc' } })
    expect(screen.getByText('Draft · not tested yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Maps leads to WhatsApp/ })).toHaveAttribute('href', agentPath('builder', 'abc'))
  })

  it('loads all agents with kind labels and links them to their builder', async () => {
    renderSidebar({ agents: { kind: 'list', activeAgentId: 'leads-recap' } })
    expect(screen.getByText('Loading agents…')).toBeInTheDocument()
    const activeAgentLink = await screen.findByRole('link', { name: /Leads to sales recap/ })
    expect(activeAgentLink).toHaveAttribute('aria-current', 'page')
    expect(activeAgentLink).toHaveAttribute('href', agentPath('builder', 'leads-recap'))
    expect(screen.getByText('Chatbot')).toBeInTheDocument()
  })

  it('shows a quiet message when agents cannot be loaded', async () => {
    vi.spyOn(sampleAgentsBackend, 'listAgents').mockRejectedValue(new BackendError('database', 'locked'))
    renderSidebar({ agents: { kind: 'list' } })
    expect(await screen.findByText('Could not load agents')).toBeInTheDocument()
  })

  it('shows the given runner line in the browser preview', async () => {
    renderSidebar({ runnerStatus: 'Online · OpenAI connected' })
    expect(screen.getByText('Online · OpenAI connected')).toBeInTheDocument()
    await screen.findByRole('link', { name: /Maps leads to WhatsApp/ })
  })

  it('hides the inbox count when there is nothing waiting', async () => {
    renderSidebar({ inboxCount: 0 })
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveTextContent(/^Inbox$/)
    await screen.findByRole('link', { name: /Maps leads to WhatsApp/ })
  })

  it('has a Plugins item right after Knowledge, marked current on the Plugins pages', async () => {
    renderSidebar({ activeNav: 'plugins' })
    const pluginsLink = screen.getByRole('link', { name: 'Plugins' })
    expect(pluginsLink).toHaveAttribute('href', routePaths.plugins)
    expect(pluginsLink).toHaveAttribute('aria-current', 'page')
    const mainLinkNames = screen.getAllByRole('link').map((link) => link.textContent)
    expect(mainLinkNames.indexOf('Plugins')).toBe(mainLinkNames.indexOf('Knowledge') + 1)
    await screen.findByRole('link', { name: /Maps leads to WhatsApp/ })
  })
})
