import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { sampleVersionsBackend } from '@/api/sampleBackend/versions'
import { VersionHistoryPage } from '@/pages/VersionHistoryPage'
import { agentPath, agentRoutePatterns } from '@/routes'

function renderVersionHistoryPage(agentId = 'maps-leads') {
  return render(
    <MemoryRouter initialEntries={[agentPath('versionHistory', agentId)]}>
      <Routes>
        <Route path={agentRoutePatterns.versionHistory} element={<VersionHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('VersionHistoryPage', () => {
  beforeEach(() => resetSampleAgents())
  afterEach(() => vi.restoreAllMocks())

  it('loads the versions, then compares the one before the current version', async () => {
    const compareSpy = vi.spyOn(sampleVersionsBackend, 'compareAgentVersions')
    renderVersionHistoryPage()
    expect(screen.getByText('Loading history…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'What changes if you restore v6' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /v7 · current/ })).toHaveTextContent('Shorter message, 30s gap')
    expect(screen.getByText('v1 to v4')).toBeInTheDocument()
    expect(await screen.findByText('max 2 sentences → max 4 sentences')).toBeInTheDocument()
    expect(screen.getAllByText('Changed')).toHaveLength(2)
    expect(compareSpy).toHaveBeenCalledWith('maps-leads', 7, 6)
    expect(await screen.findByRole('link', { name: 'Maps leads to WhatsApp', current: false })).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
  })

  it('compares another version when it is selected, numbering steps in its order', async () => {
    renderVersionHistoryPage()
    fireEvent.click(await screen.findByRole('button', { name: /^v5/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'What changes if you restore v5' })).toBeInTheDocument()
    expect(await screen.findByText('Qualify the lead')).toBeInTheDocument()
    expect(screen.getAllByText('Added')).toHaveLength(2)
    const stepRows = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(stepRows[6]).toHaveTextContent('7Ask me before sending')
  })

  it('shows which version cannot be read instead of the steps', async () => {
    vi.spyOn(sampleVersionsBackend, 'compareAgentVersions').mockResolvedValue({
      agentId: 'maps-leads',
      from: { version: 7, steps: [], error: null },
      to: { version: 6, steps: [], error: { code: 'workflow', message: 'workflow error: unknown node type `teleport`' } },
      changes: [],
    })
    renderVersionHistoryPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the steps of v6: workflow error: unknown node type `teleport`')
    expect(screen.getByRole('button', { name: 'Restore v6' })).toBeEnabled()
  })

  it('shows a failed comparison', async () => {
    vi.spyOn(sampleVersionsBackend, 'compareAgentVersions').mockRejectedValue(new BackendError('database', 'disk is busy'))
    renderVersionHistoryPage()
    expect(await screen.findByText('Could not compare the versions: disk is busy')).toBeInTheDocument()
  })

  it('restores a version through the API and undoes it', async () => {
    const restoreSpy = vi.spyOn(sampleAgentsBackend, 'restoreAgentVersion')
    renderVersionHistoryPage()
    fireEvent.click(await screen.findByRole('button', { name: /^v5/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore v5' }))
    expect(await screen.findByRole('button', { name: /v8 · current/ })).toHaveTextContent('Restored v5')
    expect(restoreSpy).toHaveBeenCalledWith('maps-leads', 5)
    expect(screen.getByRole('status')).toHaveTextContent('Restored v5 as v8')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: /v9 · current/ })).toHaveTextContent('Restored v7')
    expect(restoreSpy).toHaveBeenLastCalledWith('maps-leads', 7)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says so when the restored version already matches the current one', async () => {
    const currentAgent = await sampleAgentsBackend.getAgent('maps-leads')
    vi.spyOn(sampleAgentsBackend, 'restoreAgentVersion').mockResolvedValue(currentAgent)
    renderVersionHistoryPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore v6' }))
    expect(await screen.findByRole('status')).toHaveTextContent('v6 already matches the current version')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /v7 · current/ })).toBeInTheDocument()
  })

  it('shows a failed restore without losing the history', async () => {
    vi.spyOn(sampleAgentsBackend, 'restoreAgentVersion').mockRejectedValue(new BackendError('database', 'disk is full'))
    renderVersionHistoryPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore v6' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not restore v6: disk is full')
    expect(screen.getByRole('button', { name: /v7 · current/ })).toBeInTheDocument()
  })

  it('shows a quiet message when the history cannot be loaded', async () => {
    renderVersionHistoryPage('missing-agent')
    expect(await screen.findByText('Could not load the history: No agent with id missing-agent')).toBeInTheDocument()
  })
})
