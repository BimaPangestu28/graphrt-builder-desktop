import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleDeploy, seedSampleDeployment } from '@/api/sampleBackend/deploy'
import { resetSampleRuns } from '@/api/sampleBackend/runs'
import { sampleAgentId } from '@/routes'
import { RunsPage } from '../RunsPage'

function renderRunsPage(initialEntry = '/runs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RunsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetSampleRuns()
  resetSampleAgents()
  resetSampleDeploy()
})

describe('RunsPage on this computer / online', () => {
  it('marks every run with where it ran and filters by place', async () => {
    seedSampleDeployment(sampleAgentId)
    renderRunsPage()
    const table = screen.getByRole('table')
    await within(table).findByText('Gmail sign-in expired')
    expect(await within(table).findAllByText('Online')).toHaveLength(2)
    expect(within(table).getAllByText('On this computer').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(within(table).queryByText('On this computer')).not.toBeInTheDocument()
    expect(within(table).getByText('The AI service was busy. It will try again')).toBeInTheDocument()

    await userEvent.click(within(table).getAllByRole('button', { name: /Show run/ })[0])
    expect(screen.getByText(/ran online on Fly.io/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'On this computer' }))
    expect(within(table).queryByText('Online')).not.toBeInTheDocument()
  })

  it('opens on Online from ?where=online and explains when there are none', async () => {
    renderRunsPage('/runs?where=online')
    expect(await screen.findByText(/No online runs yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Online' })).toHaveAttribute('aria-pressed', 'true')
  })
})
