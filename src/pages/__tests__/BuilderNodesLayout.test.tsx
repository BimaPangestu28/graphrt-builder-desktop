import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { agentPath, agentRoutePatterns } from '@/routes'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { chatRailStorageKey, readChatRailPreference, writeChatRailPreference } from '../agent-builder/useChatRailPreference'
import { BuilderPage } from '../BuilderPage'

function renderBuilderPage() {
  return render(
    <MemoryRouter initialEntries={[agentPath('builder', 'maps-leads')]}>
      <Routes>
        <Route path={agentRoutePatterns.builder} element={<BuilderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const chatSection = () => screen.getByRole('region', { name: 'Chat' })

describe('Builder chat in the Nodes view', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    window.localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('starts folded on a narrow window when nothing was chosen yet', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1100)
    renderBuilderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Nodes' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'rail')
    vi.restoreAllMocks()
  })

  it('shares the page in Steps, narrows to 360px in Nodes and folds to a rail that is remembered', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440)
    renderBuilderPage()
    expect(chatSection()).toHaveAttribute('data-layout', 'wide')
    expect(screen.queryByRole('button', { name: 'Hide the chat' })).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('tab', { name: 'Nodes' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'narrow')
    expect(chatSection().className).toContain('flex-[0_0_360px]')

    fireEvent.click(screen.getByRole('button', { name: 'Hide the chat' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'rail')
    expect(window.localStorage.getItem(chatRailStorageKey)).toBe('1')

    // The prompt box stays reachable from the rail.
    fireEvent.click(screen.getByRole('button', { name: 'Describe a change' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'narrow')
    await waitFor(() => expect(screen.getByLabelText('Describe a change', { selector: 'textarea' })).toHaveFocus())
    expect(window.localStorage.getItem(chatRailStorageKey)).toBe('0')

    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'wide')
  })

  it('starts folded in Nodes when the viewer folded it before', async () => {
    writeChatRailPreference(true)
    renderBuilderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Nodes' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'rail')
    fireEvent.click(screen.getByRole('button', { name: 'Show the chat' }))
    expect(chatSection()).toHaveAttribute('data-layout', 'narrow')
  })
})

describe('chat rail preference storage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads and writes the choice', () => {
    window.localStorage.clear()
    expect(readChatRailPreference()).toBeNull()
    writeChatRailPreference(true)
    expect(readChatRailPreference()).toBe(true)
    writeChatRailPreference(false)
    expect(readChatRailPreference()).toBe(false)
  })

  it('works without storage (blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readChatRailPreference()).toBeNull()
    expect(() => writeChatRailPreference(true)).not.toThrow()
  })
})
