import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { getAgentDeployment } from '@/api/deploy'
import type { DeploymentView } from '@/api/deployTypes'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleDeploy, seedSampleDeployment } from '@/api/sampleBackend/deploy'
import { sampleAgentId } from '@/routes'
import { AgentOnlinePanel, RunPlaceBadge } from '../AgentOnlinePanel'

function Harness({ initialView }: { initialView: DeploymentView }) {
  const [view, setView] = useState<DeploymentView | null>(initialView)
  return (
    <MemoryRouter>
      <RunPlaceBadge view={view} />
      {view ? <AgentOnlinePanel agentId={sampleAgentId} agentName="Maps leads" view={view} onViewChange={setView} /> : <p>Offline now</p>}
    </MemoryRouter>
  )
}

async function renderPanel(hasChanges = false) {
  seedSampleDeployment(sampleAgentId, {}, hasChanges)
  const view = (await getAgentDeployment(sampleAgentId)) as DeploymentView
  render(<Harness initialView={view} />)
}

beforeEach(() => {
  resetSampleAgents()
  resetSampleDeploy()
})

describe('AgentOnlinePanel', () => {
  it('shows where it runs and offers to update when the agent changed', async () => {
    await renderPanel(true)
    expect(screen.getAllByText('Online · working').length).toBeGreaterThan(0)
    expect(screen.getByText('Online on Fly.io')).toBeInTheDocument()
    expect(screen.getByText('You changed this agent — update the online version?')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Update with latest changes' })[0]).toHaveAttribute('href', `/agents/${sampleAgentId}/online?screen=review`)
  })

  it('pauses, resumes and goes back to an earlier version', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(await screen.findAllByText('Online · paused')).not.toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findAllByText('Online · working')).not.toHaveLength(0)
    expect(await screen.findByText('Online now')).toBeInTheDocument()
    const goBack = screen.getAllByRole('button', { name: 'Go back to this' })
    expect(goBack).toHaveLength(2)
    await userEvent.click(goBack[0])
    expect(await screen.findByText(/deployed v2/)).toBeInTheDocument()
  })

  it('takes it offline only after the name is typed', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Take offline' }))
    const confirm = screen.getAllByRole('button', { name: 'Take offline' }).at(-1) as HTMLElement
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Type the agent's name to confirm"), 'Maps leads')
    await userEvent.click(confirm)
    expect(await screen.findByText('Offline now')).toBeInTheDocument()
    expect(screen.getByText('On this computer')).toBeInTheDocument()
  })
})
