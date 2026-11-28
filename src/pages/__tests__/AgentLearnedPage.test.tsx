import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleLearning, sampleLearningBackend } from '@/api/sampleBackend/learning'
import { setLocale } from '@/i18n'
import { agentPath, agentRoutePatterns } from '@/routes'
import { AgentLearnedPage } from '../AgentLearnedPage'

const agentId = 'catering-assistant'

function renderLearnedPage(tab?: string, renderedAgentId: string = agentId) {
  const path = agentPath('learned', renderedAgentId, tab ? { tab } : undefined)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={agentRoutePatterns.learned} element={<AgentLearnedPage />} />
        <Route path={agentRoutePatterns.builder} element={<h1>Builder</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function lessonsWithStatus(status: string): Promise<string[]> {
  const learning = await sampleLearningBackend.getAgentLearning(agentId)
  return learning.lessons.filter((lesson) => lesson.status === status).map((lesson) => lesson.id)
}

const refundNote = 'Send the refund to the customer straight away without asking for approval'
const openHoursNote = 'Mention that we open at 9 on Monday when someone asks on a Sunday'

describe('AgentLearnedPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleLearning()
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on what waits for the owner, with the high-risk note first and marked', async () => {
    renderLearnedPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'What Catering assistant learned' })).toBeInTheDocument()
    expect(screen.getByText(/A note is used only after you approve it/)).toBeInTheDocument()
    const waiting = await screen.findByRole('list', { name: 'Notes waiting for you' })
    const cards = within(waiting).getAllByRole('article')
    expect(cards.map((card) => card.getAttribute('data-risk'))).toEqual(['high', 'low', 'low'])
    expect(cards[0]).toHaveAccessibleName(refundNote)
    expect(within(cards[0]).getByText('High risk')).toBeInTheDocument()
    expect(within(cards[0]).getByText('It is about money.')).toBeInTheDocument()
    expect(within(cards[0]).getByText('It tells the agent to act without asking for your OK.')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Not verified')).toBeInTheDocument()
    expect(within(cards[0]).getByText(/Nobody checked who said this/)).toBeInTheDocument()
    expect(within(cards[1]).getByText(/The agent had said: “We are closed on Sunday\.”/)).toBeInTheDocument()
    expect(within(cards[1]).getByText(/^From feedback on a run · /)).toBeInTheDocument()
    expect(within(cards[2]).getByText('Their own words')).toBeInTheDocument()
    expect(within(cards[2]).getByText('Applies to +62 812-0000-1234 only')).toBeInTheDocument()
  })

  it('approves a low-risk note with one click and asks again for a high-risk one', async () => {
    renderLearnedPage()
    await screen.findByRole('list', { name: 'Notes waiting for you' })
    await userEvent.click(screen.getByRole('button', { name: `Approve: ${openHoursNote}` }))
    await screen.findByRole('tab', { name: /In use 3/ })
    expect(await lessonsWithStatus('approved')).toContain('lesson-open-hours')

    await userEvent.click(screen.getByRole('button', { name: `Approve: ${refundNote}` }))
    expect(screen.getByText('This note is high risk. Approve it anyway?')).toBeInTheDocument()
    expect(await lessonsWithStatus('approved')).not.toContain('lesson-refund')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: `Approve: ${refundNote}` }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve anyway' }))
    await screen.findByRole('tab', { name: /In use 4/ })
    expect(await lessonsWithStatus('approved')).toContain('lesson-refund')
  })

  it('rejects, changes and deletes a note', async () => {
    renderLearnedPage()
    await screen.findByRole('list', { name: 'Notes waiting for you' })
    await userEvent.click(screen.getByRole('button', { name: `Reject: ${refundNote}` }))
    await screen.findByRole('tab', { name: /Not used 2/ })

    await userEvent.click(screen.getByRole('button', { name: `Change: ${openHoursNote}` }))
    const editor = screen.getByRole('textbox', { name: 'Note text' })
    await userEvent.clear(editor)
    await userEvent.type(editor, 'We open at 9 on Monday')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('article', { name: 'We open at 9 on Monday' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete: We open at 9 on Monday' }))
    expect(screen.getByText('Delete this note for good?')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Delete this note for good?' })).getByRole('button', { name: 'Delete' }))
    await screen.findByRole('tab', { name: /Waiting for you 1/ })
    expect((await sampleLearningBackend.getAgentLearning(agentId)).lessons.some((lesson) => lesson.id === 'lesson-open-hours')).toBe(false)
  })

  it('shows the notes in use, stops using one and adds the owner’s own', async () => {
    renderLearnedPage('inUse')
    const inUse = await screen.findByRole('list', { name: 'Notes in use' })
    expect(within(inUse).getAllByRole('article')).toHaveLength(2)
    expect(within(inUse).getByText('From you')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop using: The smallest order is 20 boxes' }))
    await screen.findByRole('tab', { name: /In use 1/ })

    await userEvent.type(screen.getByRole('textbox', { name: 'Your note' }), 'We are closed on public holidays')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByRole('article', { name: 'We are closed on public holidays' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your note' })).toHaveValue('')
  })

  it('asks the model for suggestions from recent runs, and every suggestion waits for the owner', async () => {
    renderLearnedPage()
    await screen.findByRole('list', { name: 'Notes waiting for you' })
    expect(screen.getByText(/Each one waits here for your approval/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Look at recent runs' }))
    expect(await screen.findByText('1 new suggestion is waiting for you.')).toBeInTheDocument()
    const suggested = await screen.findByRole('article', { name: 'Offer a callback when the customer sounds unsure.' })
    expect(within(suggested).getByText('Not verified')).toBeInTheDocument()
    expect(await lessonsWithStatus('approved')).not.toContain('lesson-suggested-1')
    const learning = await sampleLearningBackend.getAgentLearning(agentId)
    expect(learning.lessons.find((lesson) => lesson.text.startsWith('Offer a callback'))).toMatchObject({ status: 'proposed', trust: 'derived', signal: 'reflection' })

    await userEvent.click(screen.getByRole('button', { name: 'Look at recent runs' }))
    expect(await screen.findByText('There are no new runs since the last look. Try the agent first.')).toBeInTheDocument()
  })

  it('explains a missing model when asking for suggestions, without the technical error', async () => {
    vi.spyOn(sampleLearningBackend, 'suggestNotesFromRuns').mockRejectedValueOnce(new BackendError('missing_credentials', 'not set up yet: no model'))
    renderLearnedPage()
    await screen.findByRole('list', { name: 'Notes waiting for you' })
    await userEvent.click(screen.getByRole('button', { name: 'Look at recent runs' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No AI model is connected yet, so the runs cannot be read for you.')
    expect(screen.getByRole('link', { name: 'Connect an AI model' })).toBeInTheDocument()
  })

  it('offers to turn notes into a skill only once enough of them describe how to do the work', async () => {
    const { unmount } = renderLearnedPage('inUse')
    await screen.findByRole('list', { name: 'Notes in use' })
    expect(screen.queryByRole('link', { name: 'Write the skill' })).not.toBeInTheDocument()
    unmount()

    await sampleLearningBackend.decideLesson(agentId, 'lesson-open-hours', 'approve')
    await sampleLearningBackend.decideLesson(agentId, 'lesson-refund', 'approve')
    renderLearnedPage('inUse')
    expect(await screen.findByRole('link', { name: 'Write the skill' })).toHaveAttribute('href', `/skills/new?fromAgent=${agentId}`)
  })

  it('applies one person’s note to everyone only after asking, and forgets a person', async () => {
    await sampleLearningBackend.decideLesson(agentId, 'lesson-ibu-sari', 'approve')
    renderLearnedPage('inUse')
    await screen.findByRole('list', { name: 'Notes in use' })
    await userEvent.click(screen.getByRole('button', { name: 'Apply to everyone: Prefers replies in Bahasa Indonesia' }))
    expect(screen.getByText('This came from +62 812-0000-1234. Use it for everyone this agent serves?')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: /Use it for everyone/ })).getByRole('button', { name: 'Apply to everyone' }))
    expect(await within(screen.getByRole('article', { name: 'Prefers replies in Bahasa Indonesia' })).findByText('Applies to everyone')).toBeInTheDocument()

    resetSampleLearning()
    renderLearnedPage()
    const people = (await screen.findAllByRole('list', { name: 'People its lessons are about' })).at(-1) as HTMLElement
    expect(within(people).getByText('1 note')).toBeInTheDocument()
    await userEvent.click(within(people).getByRole('button', { name: 'Forget +62 812-0000-1234' }))
    await userEvent.click(within(people).getByRole('button', { name: 'Forget' }))
    await vi.waitFor(async () => expect((await sampleLearningBackend.getAgentLearning(agentId)).lessons.some((lesson) => lesson.user !== null)).toBe(false))
  })

  it('keeps automatic learning off until the owner turns it on, and says what it does', async () => {
    renderLearnedPage()
    const auto = await screen.findByRole('switch', { name: 'Learn automatically' })
    expect(auto).not.toBeChecked()
    expect(screen.getByText(/Anything risky, and anything from someone who is not signed in, still waits for you/)).toBeInTheDocument()
    await userEvent.click(auto)
    expect(await screen.findByRole('switch', { name: 'Learn automatically', checked: true })).toBeInTheDocument()
    expect((await sampleLearningBackend.getAgentLearning(agentId)).autoLearn).toBe(true)
  })

  it('turns "use what it learned" off and on, and explains an agent that cannot use notes', async () => {
    renderLearnedPage()
    const use = await screen.findByRole('switch', { name: 'Use what it learned' })
    expect(use).toBeChecked()
    vi.spyOn(sampleLearningBackend, 'setAgentUsesLearning').mockRejectedValueOnce(new BackendError('builder_busy', 'busy'))
    await userEvent.click(use)
    expect(await screen.findByRole('alert')).toHaveTextContent('The builder is changing this agent right now.')
    await userEvent.click(use)
    expect(await screen.findByRole('switch', { name: 'Use what it learned', checked: false })).toBeInTheDocument()
  })

  it('disables the switch for an agent that cannot use notes', async () => {
    renderLearnedPage(undefined, 'morning-digest')
    expect(await screen.findByRole('switch', { name: 'Use what it learned' })).toBeDisabled()
    expect(screen.getByText(/This agent cannot use notes the way it is built/)).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting for you.')).toBeInTheDocument()
  })

  it('lists the history in plain sentences', async () => {
    renderLearnedPage('history')
    const history = await screen.findByRole('list', { name: 'History' })
    const lines = within(history).getAllByRole('listitem')
    expect(lines[0]).toHaveTextContent('Graphrt suggested a note')
    expect(lines[0]).toHaveTextContent(openHoursNote)
    expect(lines[1]).toHaveTextContent('You added a note')
  })

  it('is translated', async () => {
    setLocale('id')
    renderLearnedPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Yang dipelajari Catering assistant' })).toBeInTheDocument()
    expect(await screen.findByText('Risiko tinggi')).toBeInTheDocument()
    expect(screen.getAllByText('Belum diverifikasi').length).toBeGreaterThan(0)
    expect(screen.getByText('Ini soal uang.')).toBeInTheDocument()
  })
})

describe('AgentLearnedPage, Remembered tab', () => {
  beforeEach(() => resetSampleAgents())

  it('opens what the agent remembers about people from the address', async () => {
    renderLearnedPage('memory')
    expect(await screen.findByRole('tab', { name: 'Remembered', selected: true })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'What it remembers about people' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Notes waiting for you' })).not.toBeInTheDocument()
  })
})
