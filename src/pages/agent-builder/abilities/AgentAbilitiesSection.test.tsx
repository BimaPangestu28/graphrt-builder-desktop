import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAbilities, sampleAbilitiesBackend } from '@/api/sampleBackend/abilities'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { setLocale } from '@/i18n'
import { AgentAbilitiesSection } from './AgentAbilitiesSection'

function renderSection(agentId = 'maps-leads', onSaved = vi.fn()) {
  render(
    <MemoryRouter>
      <AgentAbilitiesSection agentId={agentId} agentVersion={1} onSaved={onSaved} />
    </MemoryRouter>,
  )
  return onSaved
}

async function card(name: string) {
  const title = await screen.findByText(name, { selector: 'span' })
  return title.closest('li') as HTMLElement
}

describe('AgentAbilitiesSection', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAbilities()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows each ability with a one-line summary', async () => {
    renderSection()
    expect(await screen.findByRole('heading', { name: 'What this agent can do' })).toBeInTheDocument()
    expect(within(await card('Remember conversations and customers')).getByText('Off')).toBeInTheDocument()
    expect(within(await card('Ask other agents for help')).getByText('Works alone')).toBeInTheDocument()
    expect(within(await card('Long conversations')).getByText('Makes room automatically')).toBeInTheDocument()
    expect(within(await card('Spending limit per run')).getByText('No limit')).toBeInTheDocument()
  })

  it('turns on memory with the graph as an advanced option and saves a version', async () => {
    const user = userEvent.setup()
    const onSaved = renderSection()
    await user.click(await screen.findByRole('button', { name: 'Change: Remember conversations and customers' }))
    await user.click(screen.getByRole('radio', { name: 'Remember' }))
    expect(screen.getByText(/wait for your approval before it uses them/)).toBeInTheDocument()
    await user.click(screen.getByText('Advanced'))
    await user.click(screen.getByRole('checkbox', { name: 'Also connect who and what the notes mention' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(within(await card('Remember conversations and customers')).getByText('Remembers each customer, with connections')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect((await sampleAbilitiesBackend.getAgentAbilities('maps-leads')).memory).toEqual({ enabled: true, graph: true })
  })

  it('picks helper agents in two steps and leaves out the ones that cannot help', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Change: Ask other agents for help' }))
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Maps leads to WhatsApp' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Invoice reminders' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Catering assistant' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('It may ask 1 agent for help.')).toBeInTheDocument()
    const parallel = screen.getByLabelText('Helpers working at the same time')
    await user.clear(parallel)
    await user.type(parallel, '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(within(await card('Ask other agents for help')).getByText('Can ask Catering assistant')).toBeInTheDocument()
    expect((await sampleAbilitiesBackend.getAgentAbilities('maps-leads')).helpers).toEqual({ agentIds: ['catering-assistant'], maxParallel: 2, maxCalls: 16 })
  })

  it('refuses a limit outside its bounds before saving', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Change: Ask other agents for help' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByLabelText('Helpers working at the same time')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('checkbox', { name: 'Catering assistant' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const calls = screen.getByLabelText('Requests for help in one run')
    await user.clear(calls)
    await user.type(calls, '500')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Requests for help in one run must be between 1 and 50.')
  })

  it('sets a spending limit in dollars and tokens', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Change: Spending limit per run' }))
    await user.click(screen.getByRole('radio', { name: 'Set a limit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a money or a token limit')
    await user.type(screen.getByLabelText('Most money per run (US dollars)'), '0.5')
    await user.type(screen.getByLabelText('Most tokens per run'), '20000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(within(await card('Spending limit per run')).getByText('Up to $0.50 or 20,000 tokens')).toBeInTheDocument()
    expect((await sampleAbilitiesBackend.getAgentAbilities('maps-leads')).spending).toEqual({ maxCostMicros: 500_000, maxTotalTokens: 20_000 })
  })

  it('says why an ability is not available for an agent without a step that chooses tools', async () => {
    renderSection('morning-digest')
    const memory = await card('Remember conversations and customers')
    expect(within(memory).getByText(/no step of this agent chooses its own tools/)).toBeInTheDocument()
    expect(within(memory).getByRole('button', { name: 'Change: Remember conversations and customers' })).toBeDisabled()
    expect(within(await card('Long conversations')).getByRole('button')).toBeEnabled()
  })

  it('explains that the builder is busy instead of a raw error', async () => {
    vi.spyOn(sampleAbilitiesBackend, 'setAgentAbility').mockRejectedValue(new BackendError('builder_busy', 'busy'))
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Change: Long conversations' }))
    await user.click(screen.getByRole('radio', { name: 'Summarize older parts' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The builder is changing this agent right now')
  })

  it('speaks Indonesian', async () => {
    setLocale('id')
    renderSection()
    expect(await screen.findByRole('heading', { name: 'Kemampuan agent' })).toBeInTheDocument()
    expect(within(await card('Agent bisa minta bantuan agent lain')).getByText('Bekerja sendiri')).toBeInTheDocument()
    expect(await card('Ingat percakapan dan pelanggan')).toBeInTheDocument()
  })
})
