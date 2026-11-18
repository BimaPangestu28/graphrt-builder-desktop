import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getTeam } from '@/api/chains'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleChains } from '@/api/sampleBackend/chains'
import { resetSampleTeams } from '@/api/sampleBackend/teams'
import { getTeamGuardrails } from '@/api/teams'
import { TeamPage } from '../TeamPage'

function renderTeamPage() {
  return render(
    <MemoryRouter>
      <TeamPage />
    </MemoryRouter>,
  )
}

describe('TeamPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleChains()
    resetSampleTeams()
  })

  it('shows the team, its members and guardrails', async () => {
    renderTeamPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Catering sales team' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 15 messages' })).toHaveAttribute('href', '/agents/outreach/test?runId=sample-run-outreach')
    const members = within(screen.getByRole('region', { name: 'Members' }))
    expect(members.getByText('Working')).toBeInTheDocument()
    expect(members.getByText('Needs you')).toBeInTheDocument()
    expect(members.getByText('Done')).toBeInTheDocument()
    expect(await screen.findByText('Always ask me')).toBeInTheDocument()
    expect(screen.getByText('Max 20')).toBeInTheDocument()
  })

  it('shows the activity and the coordinator chat from the team runs', async () => {
    renderTeamPage()
    const activity = within(screen.getByRole('region', { name: 'Activity' }))
    expect(await activity.findByText('13:05')).toBeInTheDocument()
    expect(activity.getByText(/finished with 64 places/)).toBeInTheDocument()
    const chat = within(screen.getByRole('region', { name: 'Talk to the coordinator' }))
    expect(await chat.findByText('Plan for this week')).toBeInTheDocument()
    expect(chat.getByText('Budget so far $0.42 of $5 this week')).toBeInTheDocument()
  })

  it('changes the agent-call guardrail', async () => {
    renderTeamPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Change agent calls per run' }))
    fireEvent.change(screen.getByLabelText('Most agent calls per run (empty for no limit)'), { target: { value: '5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(await screen.findByText('Max 5')).toBeInTheDocument()
    expect((await getTeamGuardrails('sales-team')).maxAgentCallsPerRun).toBe(5)
  })

  it('sends a message to the coordinator', async () => {
    renderTeamPage()
    await screen.findByRole('heading', { level: 1, name: 'Catering sales team' })
    fireEvent.change(screen.getByLabelText('Message the coordinator'), { target: { value: 'Skip offices this week' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(await screen.findByText('Skip offices this week')).toBeInTheDocument()
    expect(screen.getByText('Got it. I will update the plan and tell the team')).toBeInTheDocument()
    expect(screen.getByLabelText('Message the coordinator')).toHaveValue('')
  })

  it('pauses and resumes the team through the team agent status', async () => {
    renderTeamPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause team' }))
    expect(await screen.findByRole('button', { name: 'Resume team' })).toBeInTheDocument()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(1)
    expect((await getTeam('sales-team')).status).toBe('paused')
    fireEvent.click(screen.getByRole('button', { name: 'Resume team' }))
    expect(await screen.findByRole('button', { name: 'Pause team' })).toBeInTheDocument()
  })

  it('adds one of your agents as a member', async () => {
    renderTeamPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'New member' }), { target: { value: 'translate-bahasa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }))
    expect(await within(screen.getByRole('region', { name: 'Members' })).findByText('Translate to Bahasa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to team' })).not.toBeInTheDocument()
    expect((await getTeam('sales-team')).members.map((member) => member.agentId)).toContain('translate-bahasa')
  })
})
