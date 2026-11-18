import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { KnowledgeDetailPage } from '../KnowledgeDetailPage'

function renderKnowledgeDetail() {
  return render(
    <MemoryRouter>
      <KnowledgeDetailPage />
    </MemoryRouter>,
  )
}

describe('KnowledgeDetailPage', () => {
  it('shows the sources of the knowledge base', () => {
    renderKnowledgeDetail()
    expect(screen.getByRole('heading', { level: 1, name: 'Catering menu and prices' })).toBeInTheDocument()
    expect(screen.getByText('Menu November.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 page failed')).toBeInTheDocument()
  })

  it('flags a weak match and lets you write an answer', () => {
    renderKnowledgeDetail()
    expect(screen.getByText('Best match is weak. Paket Komplit includes chicken or fish')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Write an answer for this' }))
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Ada, Paket Sayur tanpa daging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
    expect(screen.getByText(/Saved to Delivery and FAQ/)).toBeInTheDocument()
  })

  it('treats the match as strong when the threshold is lowered', () => {
    renderKnowledgeDetail()
    fireEvent.change(screen.getByLabelText('Ignore matches below'), { target: { value: '0.3' } })
    expect(screen.getByText('Paket Komplit includes chicken or fish')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write an answer for this' })).not.toBeInTheDocument()
  })
})
