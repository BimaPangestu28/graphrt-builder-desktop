import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { routePaths } from '@/routes'
import { BuilderPage } from '../BuilderPage'

function renderBuilderPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.builder]}>
      <BuilderPage />
    </MemoryRouter>,
  )
}

describe('BuilderPage', () => {
  it('shows the agent steps, changed steps and what it needs', () => {
    renderBuilderPage()
    expect(screen.getByRole('heading', { name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getAllByText('Changed just now')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Connect WhatsApp on this Mac' })).toHaveAttribute('href', routePaths.connectWhatsApp)
    expect(screen.getByRole('link', { name: /Test with 1 place/ })).toHaveAttribute('href', routePaths.testRun)
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', routePaths.versionHistory)
  })

  it('undoes and redoes the last chat change', () => {
    renderBuilderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText('Changed just now')).not.toBeInTheDocument()
    expect(screen.getByText('Write a message')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByText('Write a short message')).toBeInTheDocument()
  })

  it('switches tabs and sends a change request', () => {
    renderBuilderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText(/runs_on: this-mac/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Skip places with fewer than 50 reviews' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Skip places with fewer than 50 reviews')).toBeInTheDocument()
    expect(screen.getByLabelText('Describe a change')).toHaveValue('')
  })
})
