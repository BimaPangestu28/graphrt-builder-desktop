import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addAgentTests, createAgentRelease } from '@/api/quality'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleQuality } from '@/api/sampleBackend/quality'
import { agentPath } from '@/routes'
import { DeployReleaseNotice } from './DeployReleaseNotice'

const agentId = 'catering-assistant'

function renderNotice(needsRelease = false) {
  return render(
    <MemoryRouter>
      <DeployReleaseNotice agentId={agentId} needsRelease={needsRelease} />
    </MemoryRouter>,
  )
}

describe('DeployReleaseNotice', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleQuality()
  })

  it('asks for a release first when there is none', async () => {
    renderNotice()
    expect(await screen.findByText('Release the agent first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Test & release' })).toHaveAttribute('href', agentPath('agentReleases', agentId))
  })

  it('names the release that goes online', async () => {
    await addAgentTests(agentId, [{ question: 'Hi?', goodAnswer: '', mustInclude: [], mustNotInclude: [], suggested: false }])
    await createAgentRelease(agentId, 'First', 'Demo today')
    renderNotice()
    expect(await screen.findByText(/Puts release 1 \(version \d+\) online/)).toBeInTheDocument()
    expect(screen.queryByText('Release the agent first')).toBeNull()
  })
})
