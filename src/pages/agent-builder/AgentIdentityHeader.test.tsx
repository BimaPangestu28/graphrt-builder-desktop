import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import type { Agent } from '@/api/types'
import { routePaths } from '@/routes'
import { AgentIdentityHeader } from './AgentIdentityHeader'

const agent: Agent = {
  id: 'maps-leads',
  name: 'Maps leads to WhatsApp',
  kind: 'task',
  description: 'Find cafes',
  flowYaml: 'version: "1"',
  status: 'draft',
  currentVersion: 1,
  createdAt: '2026-11-19T00:00:00Z',
  updatedAt: '2026-11-19T00:00:00Z',
}

function renderHeader(onRenamed = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/agents/maps-leads/steps']}>
      <Routes>
        <Route path="/agents/:agentId/steps" element={<AgentIdentityHeader agent={agent} onRenamed={onRenamed} />} />
        <Route path={routePaths.home} element={<p>Home screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return onRenamed
}

describe('AgentIdentityHeader', () => {
  beforeEach(() => resetSampleAgents())
  afterEach(() => vi.restoreAllMocks())

  it('renames the agent in place and tells agent lists to reload', async () => {
    const renameSpy = vi.spyOn(sampleAgentsBackend, 'renameAgent')
    const agentsChanged = vi.fn()
    window.addEventListener('graphrt:agents-changed', agentsChanged)
    const onRenamed = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: /Rename agent/ }))
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: '  Bandar Lampung promotions ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameSpy).toHaveBeenCalledWith('maps-leads', 'Bandar Lampung promotions'))
    await waitFor(() => expect(onRenamed).toHaveBeenCalled())
    expect(agentsChanged).toHaveBeenCalled()
    expect(screen.queryByLabelText('Agent name')).not.toBeInTheDocument()
    window.removeEventListener('graphrt:agents-changed', agentsChanged)
  })

  it('cancels a rename with Escape', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Rename agent/ }))
    fireEvent.keyDown(screen.getByLabelText('Agent name'), { key: 'Escape' })
    expect(screen.queryByLabelText('Agent name')).not.toBeInTheDocument()
  })

  it('shows why a rename failed and keeps the form', async () => {
    vi.spyOn(sampleAgentsBackend, 'renameAgent').mockRejectedValue(new BackendError('invalid_input', 'the name is empty'))
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Rename agent/ }))
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename: the name is empty')
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument()
  })

  it('asks before deleting, then deletes and goes Home', async () => {
    const deleteSpy = vi.spyOn(sampleAgentsBackend, 'deleteAgent').mockResolvedValue()
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/run history and its schedules are deleted/)
    expect(deleteSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete agent' }).at(-1)!)
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(deleteSpy).toHaveBeenCalledWith('maps-leads')
  })

  it('keeps the agent when the user changes their mind', () => {
    const deleteSpy = vi.spyOn(sampleAgentsBackend, 'deleteAgent')
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
