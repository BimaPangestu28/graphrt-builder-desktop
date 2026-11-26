import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleLearning, sampleLearningBackend } from '@/api/sampleBackend/learning'
import { resetSampleRuns, sampleRunsBackend } from '@/api/sampleBackend/runs'
import { agentPath } from '@/routes'
import { RunFeedbackCard } from './RunFeedbackCard'

const agentId = 'maps-leads'

async function renderCard() {
  const runs = await sampleRunsBackend.listRuns({ agentId, limit: 50 })
  const run = runs.find((candidate) => candidate.status === 'succeeded' || candidate.status === 'failed')
  if (!run) throw new Error('no finished sample run')
  render(
    <MemoryRouter>
      <RunFeedbackCard agentId={agentId} runId={run.id} />
    </MemoryRouter>,
  )
  return run.id
}

describe('RunFeedbackCard', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleRuns()
    resetSampleLearning()
  })
  afterEach(() => vi.restoreAllMocks())

  it('records a yes at once and proposes nothing', async () => {
    const record = vi.spyOn(sampleLearningBackend, 'recordRunFeedback')
    const runId = await renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks, noted.')
    expect(record).toHaveBeenCalledWith(runId, { helpful: true, comment: null })
    expect(screen.queryByRole('link', { name: 'See what it learned' })).not.toBeInTheDocument()
  })

  it('asks what should be different after a no, and the answer waits for approval', async () => {
    await renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'No, something was off' }))
    expect(screen.getByText(/It becomes a note that waits for your approval\. Passwords and keys are hidden/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('What should it do differently next time?'), 'Skip places without a phone number')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your note is waiting for your approval.')
    expect(screen.getByRole('link', { name: 'See what it learned' })).toHaveAttribute('href', agentPath('learned', agentId))
    const learning = await sampleLearningBackend.getAgentLearning(agentId)
    expect(learning.lessons).toHaveLength(1)
    expect(learning.lessons[0]).toMatchObject({ text: 'Skip places without a phone number', status: 'proposed', trust: 'derived' })
  })

  it('says when the feedback could not be sent', async () => {
    vi.spyOn(sampleLearningBackend, 'recordRunFeedback').mockRejectedValueOnce(new Error('the disk is full'))
    await renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send: the disk is full')
  })
})
