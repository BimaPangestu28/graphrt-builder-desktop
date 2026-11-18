import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { agentPath, agentRoutePatterns } from '@/routes'
import { RunPanel } from './RunWorkspace'

function LocationProbe() {
  return <p>At {useLocation().pathname}</p>
}

function renderRunPanelFor(agentId: string) {
  render(
    <MemoryRouter initialEntries={[agentPath('testRun', agentId)]}>
      <Routes>
        <Route path={agentRoutePatterns.testRun} element={<RunPanel headerAction={null}>Run details</RunPanel>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RunPanel view tabs', () => {
  it('opens the steps of the agent in the route', () => {
    renderRunPanelFor('agent-42')
    fireEvent.click(screen.getByRole('button', { name: 'Steps' }))
    expect(screen.getByText(`At ${agentPath('builder', 'agent-42')}`)).toBeInTheDocument()
  })

  it('opens the version history of the agent in the route', () => {
    renderRunPanelFor('agent-42')
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.getByText(`At ${agentPath('versionHistory', 'agent-42')}`)).toBeInTheDocument()
  })
})
