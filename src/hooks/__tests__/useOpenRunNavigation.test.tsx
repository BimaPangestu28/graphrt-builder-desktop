import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { OpenRunRequest } from '@/api/appSettingsTypes'
import { OpenRunNavigation } from '../useOpenRunNavigation'

const openRunListeners: Array<(request: OpenRunRequest) => void> = []
const unsubscribe = vi.fn()

vi.mock('@/api/appSettings', () => ({
  subscribeToOpenRunRequests: (onOpenRun: (request: OpenRunRequest) => void) => {
    openRunListeners.push(onOpenRun)
    return Promise.resolve(unsubscribe)
  },
}))

function CurrentLocation() {
  const location = useLocation()
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
}

describe('OpenRunNavigation', () => {
  it('opens the run of a clicked notification and stops listening on unmount', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/home']}>
        <OpenRunNavigation />
        <CurrentLocation />
      </MemoryRouter>,
    )
    await waitFor(() => expect(openRunListeners).toHaveLength(1))
    act(() => openRunListeners[0]({ runId: 'run-7', agentId: 'maps-leads' }))
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/agents/maps-leads/test?runId=run-7')
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
