import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { listInstalledPlugins } from '@/api/plugins'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStoredAgent } from '@/api/sampleBackend/sampleAgentStore'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { sampleNodeKinds } from '@/api/sampleBackend/sampleNodeKinds'
import { installReactFlowTestEnvironment } from '@/test/reactFlowTestEnvironment'
import { AddNodePalette } from '../../AddNodePalette'
import type { AddNodePaletteProps } from '../../contracts'
import { NodesView } from '../../NodesView'
import { nodeKindDragType } from '../paletteDrag'
import { isAddNodeShortcut } from '../useAddNodePalette'

async function renderPalette(overrides: Partial<AddNodePaletteProps> = {}) {
  const graph: AgentGraph = await sampleAgentGraphBackend.getAgentGraph('maps-leads')
  const props: AddNodePaletteProps = {
    isOpen: true,
    nodeKinds: sampleNodeKinds,
    graph,
    readOnly: false,
    onAddNode: vi.fn(),
    onClose: vi.fn(),
    onPlaceNode: vi.fn(),
    onPluginInstalled: vi.fn(),
    anchor: { type: 'after-node', nodeId: 'write_message' },
    ...overrides,
  }
  render(<AddNodePalette {...props} />)
  return { props, search: screen.getByRole('combobox', { name: 'Search steps, plugins and actions' }) }
}

async function isInstalled(pluginName: string): Promise<boolean> {
  return (await listInstalledPlugins()).some((installedPlugin) => installedPlugin.name === pluginName)
}

describe('AddNodePalette', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSamplePlugins()
  })

  it('browses Built-in by group, installed plugins and the catalog, and says where it adds', async () => {
    await renderPalette()
    expect(screen.getByText('Adds after Write a short message')).toBeInTheDocument()
    const builtin = screen.getByRole('region', { name: 'Built-in' })
    expect(within(builtin).getByRole('group', { name: 'AI' })).toHaveTextContent('Ask a model')
    expect(within(builtin).queryByText('variable-assigner')).not.toBeInTheDocument()
    expect(within(builtin).queryByText('Start')).not.toBeInTheDocument()
    const installed = screen.getByRole('region', { name: 'Installed plugins' })
    expect(within(installed).getByRole('button', { name: /WhatsApp Web.*2 actions/ })).toBeInTheDocument()
    const catalog = screen.getByRole('region', { name: 'From the plugin catalog' })
    const telegram = within(catalog).getByRole('button', { name: /Telegram Bot/ })
    expect(telegram).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(telegram)
    expect(within(catalog).getByRole('option', { name: /Send Telegram message/ })).toHaveTextContent('Install')
  })

  it('searches with ↑ ↓ and adds the highlighted action with Enter', async () => {
    const { props, search } = await renderPalette()
    fireEvent.change(search, { target: { value: 'send' } })
    const results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).getAllByRole('option')[0]).toHaveTextContent('WhatsApp Web › Send WhatsApp message')
    expect(search).toHaveAttribute('aria-activedescendant', 'palette-option-whatsapp-web-send_message')

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-activedescendant', 'palette-option-telegram-bot-send_message')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    // Wraps around to the last result.
    expect(search.getAttribute('aria-activedescendant')).toBe(within(results).getAllByRole('option').at(-1)!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(props.onPlaceNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({ id: 'send_whatsapp_message', kind: 'whatsapp-web.send_message' }),
        anchor: { type: 'after-node', nodeId: 'write_message' },
        description: 'added Send WhatsApp message after Write a short message',
      }),
    )
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows an empty state and closes with Esc', async () => {
    const { props, search } = await renderPalette()
    fireEvent.change(search, { target: { value: 'zebra' } })
    expect(screen.getByText('Nothing matches “zebra”')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onPlaceNode).not.toHaveBeenCalled()
  })

  it('installs a catalog plugin only after the explicit OK, then adds its action', async () => {
    const { props, search } = await renderPalette()
    fireEvent.change(search, { target: { value: 'telegram' } })
    fireEvent.click(screen.getByRole('option', { name: /Send Telegram message/ }))

    const approval = screen.getByRole('alertdialog', { name: 'Install Telegram Bot?' })
    expect(approval).toHaveTextContent('To add Send Telegram message after Write a short message')
    expect(await within(approval).findByText(/asks for: internet, secrets, 1 setting \(TELEGRAM_BOT_TOKEN\)/)).toBeInTheDocument()
    expect(props.onPlaceNode).not.toHaveBeenCalled()
    expect(await isInstalled('telegram-bot')).toBe(false)

    // Esc on the approval cancels it and installs nothing.
    fireEvent.keyDown(within(approval).getByRole('button', { name: /Install Telegram Bot and add/ }), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(await isInstalled('telegram-bot')).toBe(false)

    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Install Telegram Bot and add Send Telegram message' }))
    await waitFor(() => expect(props.onPlaceNode).toHaveBeenCalledTimes(1))
    expect(await isInstalled('telegram-bot')).toBe(true)
    expect(props.onPluginInstalled).toHaveBeenCalledWith('telegram-bot')
    expect(props.onPlaceNode).toHaveBeenCalledWith(expect.objectContaining({ node: expect.objectContaining({ kind: 'telegram-bot.send_message' }) }))
  })

  it('adds nothing while read-only', async () => {
    const { props, search } = await renderPalette({ readOnly: true })
    expect(screen.getByText(/The builder is changing this agent/)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'format' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(props.onPlaceNode).not.toHaveBeenCalled()
  })
})

describe('Add node in the Nodes view', () => {
  beforeAll(() => installReactFlowTestEnvironment())
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    resetSamplePlugins()
  })

  it('recognises "A" and ⌘K / Ctrl+K only', () => {
    const noModifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
    expect(isAddNodeShortcut({ key: 'a', ...noModifiers })).toBe(true)
    expect(isAddNodeShortcut({ key: 'k', ...noModifiers, metaKey: true })).toBe(true)
    expect(isAddNodeShortcut({ key: 'K', ...noModifiers, ctrlKey: true })).toBe(true)
    expect(isAddNodeShortcut({ key: 'a', ...noModifiers, metaKey: true })).toBe(false)
    expect(isAddNodeShortcut({ key: 'k', ...noModifiers })).toBe(false)
  })

  it('opens with "A", adds a step as one undo step, and ignores "A" typed in a field', async () => {
    render(<NodesView agent={readStoredAgent('maps-leads')} />)
    await screen.findByTestId('node-canvas')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Auto-layout' }), { key: 'a' })
    const search = await screen.findByRole('combobox', { name: 'Search steps, plugins and actions' })
    fireEvent.keyDown(search, { key: 'a' })
    expect(screen.getAllByRole('complementary', { name: 'Add node' })).toHaveLength(1)

    fireEvent.change(search, { target: { value: 'format' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.queryByRole('complementary', { name: 'Add node' })).not.toBeInTheDocument()
    const toolbar = screen.getByRole('toolbar', { name: 'Nodes' })
    expect(within(toolbar).getByRole('status')).toHaveTextContent('Unsaved changes')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Undo' }))
    expect(within(toolbar).getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('adds a dropped step, and opens the install approval for a dropped catalog action', async () => {
    render(<NodesView agent={readStoredAgent('maps-leads')} />)
    await screen.findByTestId('node-canvas')
    const dropZone = screen.getByTestId('palette-drop-zone')
    const dataTransfer = (kind: string) => ({ types: [nodeKindDragType], getData: (type: string) => (type === nodeKindDragType ? kind : ''), dropEffect: 'none' })

    act(() => {
      fireEvent.dragOver(dropZone, { dataTransfer: dataTransfer('template-transform'), clientX: 40, clientY: 40 })
    })
    expect(screen.getByTestId('palette-drop-ghost')).toHaveTextContent('Drop to add it here')
    act(() => {
      fireEvent.drop(dropZone, { dataTransfer: dataTransfer('template-transform'), clientX: 40, clientY: 40 })
    })
    expect(screen.queryByTestId('palette-drop-ghost')).not.toBeInTheDocument()
    expect(within(screen.getByRole('toolbar', { name: 'Nodes' })).getByRole('status')).toHaveTextContent('Unsaved changes')

    act(() => {
      fireEvent.drop(dropZone, { dataTransfer: dataTransfer('telegram-bot.send_message'), clientX: 40, clientY: 40 })
    })
    expect(await screen.findByRole('alertdialog', { name: 'Install Telegram Bot?' })).toBeInTheDocument()
    expect(await isInstalled('telegram-bot')).toBe(false)
  })
})
