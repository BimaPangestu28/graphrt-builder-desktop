import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleChains } from '@/api/sampleBackend/chains'
import { AgentAsStepPage } from '../AgentAsStepPage'

function renderAgentAsStepPage(initialEntry = '/agents/leads-recap/add-step') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AgentAsStepPage />
    </MemoryRouter>,
  )
}

describe('AgentAsStepPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleChains()
  })

  it('shows the agent steps, where the step goes and the catalog of your agents', async () => {
    renderAgentAsStepPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Add the step after' })).toHaveDisplayValue('Search Google Maps')
    expect(screen.getByText('Lead qualifier')).toBeInTheDocument()
    expect(screen.getByText('In place · Out score, reason · used in 2 agents')).toBeInTheDocument()
    // The target agent itself is not offered.
    expect(screen.queryByRole('button', { name: 'Add Maps leads to WhatsApp' })).not.toBeInTheDocument()
  })

  it('adds an agent as a tool step after the chosen step', async () => {
    renderAgentAsStepPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Lead qualifier' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Added Run Lead qualifier')
    expect(await screen.findByText('Runs your agent Lead qualifier · v3')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'My agents' })).getByText('Added')).toBeInTheDocument()
  })

  it('filters the catalog by search text', async () => {
    renderAgentAsStepPage()
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search agents' }), { target: { value: 'indonesian' } })
    const catalog = within(screen.getByRole('list', { name: 'My agents' }))
    expect(catalog.getByText('Translate to Bahasa')).toBeInTheDocument()
    expect(catalog.queryByText('Morning email digest')).not.toBeInTheDocument()
  })

  it('shows why the step could not be added', async () => {
    renderAgentAsStepPage('/agents/leads-recap/add-step?agentId=morning-digest')
    expect(await screen.findByRole('heading', { level: 1, name: 'Morning email digest' })).toBeInTheDocument()
    expect(screen.getAllByText("Can't run as a step").length).toBeGreaterThan(0)
  })
})
