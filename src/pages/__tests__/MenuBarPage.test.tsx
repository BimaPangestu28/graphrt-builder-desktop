import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MenuBarPage } from '@/pages/MenuBarPage'

function renderMenuBarPage() {
  return render(
    <MemoryRouter>
      <MenuBarPage />
    </MemoryRouter>,
  )
}

describe('MenuBarPage', () => {
  it('shows the menu popover and the system notifications', () => {
    renderMenuBarPage()
    expect(screen.getByRole('region', { name: 'graphrt menu' })).toBeInTheDocument()
    expect(screen.getByText('Needs you · 3')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Lead tracker progress' })).toHaveAttribute('aria-valuenow', '6')
    expect(screen.getByRole('article', { name: '[CAFE NAME] wants to order' })).toBeInTheDocument()
  })

  it('pauses and resumes all agents', () => {
    renderMenuBarPage()
    fireEvent.click(screen.getByRole('button', { name: 'Pause all agents for 1 hour' }))
    expect(screen.getByText('Paused for 1 hour')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume all agents' }))
    expect(screen.getByText('Runner online')).toBeInTheDocument()
  })

  it('snoozes the review notification', () => {
    renderMenuBarPage()
    fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }))
    expect(screen.queryByRole('article', { name: '12 messages ready to review' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('comes back in 1 hour')
  })
})
