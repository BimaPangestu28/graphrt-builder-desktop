import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChainPage } from '../ChainPage'

function renderChainPage() {
  return render(
    <MemoryRouter>
      <ChainPage />
    </MemoryRouter>,
  )
}

describe('ChainPage', () => {
  it('shows the chain with its agents and the first link selected', () => {
    renderChainPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Leads to sales recap' })).toBeInTheDocument()
    expect(screen.getByText('Sales recap to Telegram')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Pass data to Lead tracker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'If sent_count is more than 0 · places → leads' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the second link and updates its label when the condition changes', () => {
    renderChainPage()
    fireEvent.click(screen.getByRole('button', { name: 'Always · new_rows → items' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Pass data to Sales recap to Telegram' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Run Sales recap to Telegram' }), { target: { value: 'Only if the first agent failed' } })
    expect(screen.getByRole('button', { name: 'If the first agent failed · new_rows → items' })).toBeInTheDocument()
  })

  it('activates the draft chain', () => {
    renderChainPage()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
