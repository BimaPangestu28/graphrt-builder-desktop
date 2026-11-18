import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { buildItemDurationMs, openBuilderDelayMs } from '@/data/mapsLeadsAgent'
import { routePaths } from '@/routes'
import { GeneratingPage } from '../GeneratingPage'

function renderGeneratingPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.generating]}>
      <Routes>
        <Route path={routePaths.generating} element={<GeneratingPage />} />
        <Route path={routePaths.builder} element={<p>Builder screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GeneratingPage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the build mid-way with three steps ready', () => {
    renderGeneratingPage()
    expect(screen.getByRole('heading', { name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText('Building your agent')).toBeInTheDocument()
    expect(screen.getByText(/Checking it again/)).toHaveTextContent('In progress')
    expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('For each place')).toBeInTheDocument()
    expect(screen.queryByText('Send WhatsApp')).not.toBeInTheDocument()
  })

  it('finishes the remaining items and opens the builder', () => {
    renderGeneratingPage()
    act(() => vi.advanceTimersByTime(buildItemDurationMs))
    expect(screen.getByText(/Checking it again/)).toHaveTextContent('Done')
    act(() => vi.advanceTimersByTime(buildItemDurationMs))
    expect(screen.getByText('Your agent is ready')).toBeInTheDocument()
    expect(screen.getByText('Send WhatsApp')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(openBuilderDelayMs))
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })
})
