import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VersionHistoryPage } from '@/pages/VersionHistoryPage'

function renderVersionHistoryPage() {
  return render(
    <MemoryRouter>
      <VersionHistoryPage />
    </MemoryRouter>,
  )
}

describe('VersionHistoryPage', () => {
  it('previews what restoring v5 would change', () => {
    renderVersionHistoryPage()
    expect(screen.getByRole('heading', { level: 1, name: 'What changes if you restore v5' })).toBeInTheDocument()
    expect(screen.getAllByText('Removed')).toHaveLength(2)
    expect(screen.getByText('max 2 sentences → max 4 sentences')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Changed 2 steps in v7')
  })

  it('compares another version when it is selected', () => {
    renderVersionHistoryPage()
    fireEvent.click(screen.getByRole('button', { name: /^v6/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'What changes if you restore v6' })).toBeInTheDocument()
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
    expect(screen.getAllByText('Changed')).toHaveLength(2)
  })

  it('restores a version as a new one and undoes it', () => {
    renderVersionHistoryPage()
    fireEvent.click(screen.getByRole('button', { name: 'Restore v5' }))
    expect(screen.getByRole('button', { name: /v8 · current/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Restored v5 as v8')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('button', { name: /v8/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /v7 · current/ })).toBeInTheDocument()
  })
})
