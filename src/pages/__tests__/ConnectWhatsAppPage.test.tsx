import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { formatCountdown } from '@/data/whatsAppPairing'
import { routePaths } from '@/routes'
import { ConnectWhatsAppPage } from '../ConnectWhatsAppPage'

function renderConnectWhatsAppPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.connectWhatsApp]}>
      <Routes>
        <Route path={routePaths.connectWhatsApp} element={<ConnectWhatsAppPage />} />
        <Route path={routePaths.builder} element={<p>Builder screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ConnectWhatsAppPage', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the pairing dialog with a QR code and focuses Close', () => {
    renderConnectWhatsAppPage()
    expect(screen.getByRole('dialog', { name: 'Connect WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'QR code to link WhatsApp' }).children).toHaveLength(441)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('counts down and refreshes the code at zero', () => {
    vi.useFakeTimers()
    renderConnectWhatsAppPage()
    expect(screen.getByRole('status')).toHaveTextContent('code refreshes in 0:48')
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByRole('status')).toHaveTextContent('code refreshes in 0:45')
    act(() => vi.advanceTimersByTime(45000))
    expect(screen.getByRole('status')).toHaveTextContent('code refreshes in 1:00')
  })

  it('returns to the builder on Close', () => {
    renderConnectWhatsAppPage()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderConnectWhatsAppPage()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })
})

describe('formatCountdown', () => {
  it('pads seconds', () => {
    expect(formatCountdown(48)).toBe('0:48')
    expect(formatCountdown(65)).toBe('1:05')
  })
})
