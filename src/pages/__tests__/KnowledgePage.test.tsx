import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { routePaths } from '@/routes'
import { KnowledgePage } from '../KnowledgePage'

function renderKnowledge() {
  return render(
    <MemoryRouter>
      <KnowledgePage />
    </MemoryRouter>,
  )
}

describe('KnowledgePage', () => {
  it('lists the knowledge bases linking to their detail', () => {
    renderKnowledge()
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Catering menu and prices/ })).toHaveAttribute('href', routePaths.knowledgeDetail)
    expect(screen.getByText('Syncing 64%')).toBeInTheDocument()
  })

  it('shows search matches for the query and updates as you type', () => {
    renderKnowledge()
    expect(screen.getByText('0.91')).toBeInTheDocument()
    expect(screen.getByText('0.74')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search knowledge' }), { target: { value: 'opening hours' } })
    expect(screen.getByText('Nothing in your knowledge matches this yet')).toBeInTheDocument()
  })
})
