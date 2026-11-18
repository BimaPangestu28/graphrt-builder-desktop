import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from '@/pages/SettingsPage'

function renderSettingsPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  it('opens on the Runner section with runner and privacy groups', () => {
    renderSettingsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Runner' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Privacy and data' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Start graphrt when I log in/ })).toBeChecked()
  })

  it('toggles a setting and keeps it after switching sections', () => {
    renderSettingsPage()
    const crashReportsToggle = screen.getByRole('checkbox', { name: /Share anonymous crash reports/ })
    expect(crashReportsToggle).not.toBeChecked()
    fireEvent.click(crashReportsToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.queryByRole('heading', { name: 'Runner' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Privacy and data' }))
    expect(screen.getByRole('checkbox', { name: /Share anonymous crash reports/ })).toBeChecked()
  })

  it('asks before deleting all data', () => {
    renderSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(screen.getByRole('status')).toHaveTextContent('deleted')
  })

  it('opens the remote runner section from the promo card', () => {
    renderSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Connect a server' }))
    expect(screen.getByRole('heading', { name: 'Remote runner' })).toBeInTheDocument()
  })
})
