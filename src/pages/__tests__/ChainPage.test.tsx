import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { listChains } from '@/api/chains'
import { resetSampleChains } from '@/api/sampleBackend/chains'
import { ChainPage } from '../ChainPage'

function renderChainPage() {
  return render(
    <MemoryRouter>
      <ChainPage />
    </MemoryRouter>,
  )
}

async function renderLoadedChainPage() {
  renderChainPage()
  await screen.findByRole('heading', { level: 1, name: 'Leads to sales recap' })
}

describe('ChainPage', () => {
  beforeEach(() => resetSampleChains())

  it('shows the chain with its agents and the first link selected', async () => {
    await renderLoadedChainPage()
    expect(screen.getByText('Sales recap to Telegram')).toBeInTheDocument()
    expect(screen.getByText('Starts when Maps leads to WhatsApp runs')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Pass data to Lead tracker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'If it succeeded · places → leads' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox', { name: 'Value for leads' })).toHaveValue('output:places')
    expect(screen.getByRole('textbox', { name: 'Text for source' })).toHaveValue('Google Maps outreach')
  })

  it('edits the second link and saves it', async () => {
    await renderLoadedChainPage()
    fireEvent.click(screen.getByRole('button', { name: 'Always · new_rows → items' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Pass data to Sales recap to Telegram' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Run Sales recap to Telegram' }), { target: { value: 'on_success' } })
    expect(screen.getByRole('button', { name: 'If it succeeded · new_rows → items' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    await screen.findByRole('button', { name: 'Saved' })
    const [savedChain] = await listChains()
    expect(savedChain.steps[2].runCondition).toBe('on_success')
  })

  it('activates and pauses the chain', async () => {
    await renderLoadedChainPage()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    await screen.findByRole('button', { name: 'Pause' })
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect((await listChains())[0].status).toBe('active')
  })

  it('tests the chain by starting its first agent', async () => {
    await renderLoadedChainPage()
    fireEvent.click(screen.getByRole('button', { name: 'Test chain' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Started Maps leads to WhatsApp')
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute('href', '/agents/maps-leads/test?runId=sample-chain-run-1')
  })

  it('adds and removes agents', async () => {
    await renderLoadedChainPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent to add' }), { target: { value: 'translate-bahasa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
    await screen.findByRole('heading', { level: 2, name: 'Pass data to Translate to Bahasa' })
    expect((await listChains())[0].steps.map((step) => step.agentId)).toEqual(['maps-leads', 'lead-tracker', 'sales-recap', 'translate-bahasa'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove Lead tracker' }))
    await waitFor(async () => expect((await listChains())[0].steps.map((step) => step.agentId)).toEqual(['maps-leads', 'sales-recap', 'translate-bahasa']))
  })

  it('offers to create a chain when there is none', async () => {
    const { deleteChain } = await import('@/api/chains')
    await deleteChain('leads-recap')
    renderChainPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New chain' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New chain' })).toBeInTheDocument()
    expect(screen.getByText('Add the agent that starts the chain')).toBeInTheDocument()
  })
})
