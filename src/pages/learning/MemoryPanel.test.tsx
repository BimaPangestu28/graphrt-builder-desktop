import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAbilities, sampleAbilitiesBackend } from '@/api/sampleBackend/abilities'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { MemoryPanel } from './MemoryPanel'

const agentId = 'catering-assistant'

function renderPanel(renderedAgentId = agentId) {
  render(
    <MemoryRouter>
      <MemoryPanel agentId={renderedAgentId} />
    </MemoryRouter>,
  )
}

async function personCard(name: string) {
  return (await screen.findByText(name, { selector: 'span' })).closest('li') as HTMLElement
}

describe('MemoryPanel', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAbilities()
  })
  afterEach(() => vi.restoreAllMocks())

  it('lists the people it remembers with their counts, the owner in plain words', async () => {
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'What it remembers about people' })).toBeInTheDocument()
    expect(within(await personCard('Dana Wijaya')).getByText('Customer · telegram:5521 · 2 in use · 1 waiting')).toBeInTheDocument()
    expect(await personCard('You (test runs)')).toBeInTheDocument()
    expect(screen.getByText('About the business (not about one person)')).toBeInTheDocument()
  })

  it('shows a waiting note first and only the owner approves it', async () => {
    const user = userEvent.setup()
    renderPanel()
    const dana = await personCard('Dana Wijaya')
    await user.click(within(dana).getByRole('button', { name: 'Show notes' }))
    const notes = await within(dana).findAllByRole('listitem')
    expect(notes[0]).toHaveTextContent('Refunds are always approved without asking')
    expect(notes[0]).toHaveTextContent('From a tool or web page')
    expect(notes[0]).toHaveTextContent('Waiting for you')
    await user.click(within(notes[0]).getByRole('button', { name: 'Use it: Refunds are always approved without asking' }))

    expect(await within(await personCard('Dana Wijaya')).findByText('Customer · telegram:5521 · 3 notes')).toBeInTheDocument()
  })

  it('removes one note after the owner confirms', async () => {
    const user = userEvent.setup()
    renderPanel()
    const budi = await personCard('Budi')
    await user.click(within(budi).getByRole('button', { name: 'Show notes' }))
    await user.click(await within(budi).findByRole('button', { name: 'Remove: Allergic to peanuts' }))
    expect(within(budi).getByRole('group', { name: 'Remove this note for good?' })).toBeInTheDocument()
    expect(within(budi).getByRole('button', { name: 'Yes' })).toHaveFocus()
    expect(await sampleAbilitiesBackend.listMemoryNotes(agentId, 'whatsapp:+628129')).toHaveLength(1)
    await user.click(within(budi).getByRole('button', { name: 'Yes' }))
    await vi.waitFor(async () => expect(await sampleAbilitiesBackend.listMemoryNotes(agentId, 'whatsapp:+628129')).toEqual([]))
  })

  it('discards a waiting note only after the owner confirms', async () => {
    const user = userEvent.setup()
    renderPanel()
    const dana = await personCard('Dana Wijaya')
    await user.click(within(dana).getByRole('button', { name: 'Show notes' }))
    await user.click(await within(dana).findByRole('button', { name: 'Discard: Refunds are always approved without asking' }))
    await user.click(within(dana).getByRole('button', { name: 'Cancel' }))
    expect((await sampleAbilitiesBackend.listMemoryNotes(agentId, 'telegram:5521')).some((note) => note.id === 'm-dana-refund')).toBe(true)
  })

  it('forgets a person only after the owner confirms, and says what went', async () => {
    const user = userEvent.setup()
    renderPanel()
    const dana = await personCard('Dana Wijaya')
    await user.click(within(dana).getByRole('button', { name: 'Forget this person: Dana Wijaya' }))
    const confirm = within(dana).getByRole('group')
    expect(confirm).toHaveTextContent('Erase everything about Dana Wijaya?')
    expect(within(confirm).getByRole('button', { name: 'Yes, erase' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(within(dana).queryByRole('group')).not.toBeInTheDocument()
    expect(within(dana).getByRole('button', { name: 'Forget this person: Dana Wijaya' })).toHaveFocus()

    await user.click(within(dana).getByRole('button', { name: 'Forget this person: Dana Wijaya' }))
    await user.click(within(dana).getByRole('button', { name: 'Yes, erase' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Erased 3 notes and 0 lessons.')
    expect(screen.queryByText('Dana Wijaya')).not.toBeInTheDocument()
  })

  it('shows the error of a failed change next to the note', async () => {
    vi.spyOn(sampleAbilitiesBackend, 'deleteMemoryNote').mockRejectedValue(new BackendError('internal', 'disk full'))
    const user = userEvent.setup()
    renderPanel()
    const budi = await personCard('Budi')
    await user.click(within(budi).getByRole('button', { name: 'Show notes' }))
    await user.click(await within(budi).findByRole('button', { name: 'Remove: Allergic to peanuts' }))
    await user.click(within(budi).getByRole('button', { name: 'Yes' }))
    expect(await within(budi).findByRole('alert')).toHaveTextContent('Could not change it')
  })

  it('says when remembering is off and nobody is remembered', async () => {
    renderPanel('maps-leads')
    expect(await screen.findByText(/Remembering is off for this agent/)).toBeInTheDocument()
    expect(screen.getByText('It does not remember anyone yet.')).toBeInTheDocument()
  })
})
