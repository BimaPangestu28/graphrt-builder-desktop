import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AgentAsStepPage } from '../AgentAsStepPage'

function renderAgentAsStepPage() {
  return render(
    <MemoryRouter>
      <AgentAsStepPage />
    </MemoryRouter>,
  )
}

describe('AgentAsStepPage', () => {
  it('shows the agent steps with Lead qualifier inserted', () => {
    renderAgentAsStepPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText('Qualify the lead')).toBeInTheDocument()
    expect(screen.getByText('Runs your agent Lead qualifier · v3')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'My agents' })).toHaveAttribute('aria-selected', 'true')
  })

  it('swaps the inserted step when another agent is added', () => {
    renderAgentAsStepPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add Translate to Bahasa' }))
    expect(screen.getByText('Translate the message')).toBeInTheDocument()
    expect(screen.queryByText('Qualify the lead')).not.toBeInTheDocument()
  })

  it('filters the catalog by search text', () => {
    renderAgentAsStepPage()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search steps' }), { target: { value: 'indonesian' } })
    expect(screen.getByText('Translate to Bahasa')).toBeInTheDocument()
    expect(screen.queryByText('Morning email digest', { selector: 'aside span' })).not.toBeInTheDocument()
  })
})
