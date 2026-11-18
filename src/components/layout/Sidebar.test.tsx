import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'

function renderSidebar(props: Parameters<typeof Sidebar>[0]) {
  return render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  it('marks the active nav item as the current page', () => {
    renderSidebar({ activeNav: 'runs' })
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('shows the empty message before any agent exists', () => {
    renderSidebar({ agents: { kind: 'empty' } })
    expect(screen.getByText('No agents yet. Your first one will show up here')).toBeInTheDocument()
  })

  it('shows a highlighted draft agent with its status', () => {
    renderSidebar({ agents: { kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Draft · not tested yet' } })
    expect(screen.getByText('Draft · not tested yet')).toBeInTheDocument()
  })

  it('lists all agents with kind labels', () => {
    renderSidebar({ agents: { kind: 'list', activeAgentId: 'leads-recap' } })
    expect(screen.getByRole('link', { name: /Leads to sales recap/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Chatbot')).toBeInTheDocument()
  })

  it('hides the inbox count when there is nothing waiting', () => {
    renderSidebar({ inboxCount: 0 })
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveTextContent(/^Inbox$/)
  })
})
