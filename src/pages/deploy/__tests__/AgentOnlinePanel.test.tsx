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

  it('makes a new access key from the developer details and shows it once', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('Advanced (for developers)'))
    expect(screen.getByText(/Access key: kept on this computer/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make a new key' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/The current one stops working/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make a new key' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make a new key' }))
    expect(await screen.findByText('grk_sample_new_key_1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make a new key' })).not.toBeInTheDocument()
  })

  it('offers to remove what a failed first try left on the provider', async () => {
    seedSampleDeployment(sampleAgentId, { status: 'failed', statusMessage: 'Its online copy was created on Fly.io and its access key is saved, but it didn’t start' })
    const view = (await getAgentDeployment(sampleAgentId)) as DeploymentView
    render(<Harness initialView={view} />)
    expect(screen.getByText("It didn't go online")).toBeInTheDocument()
    expect(screen.getByText(/online copy was created on Fly.io/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove what was created on Fly.io' }))
    expect(await screen.findByText('Offline now')).toBeInTheDocument()
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
