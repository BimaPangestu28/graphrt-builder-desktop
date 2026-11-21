import { fireEvent, screen, waitFor } from '@testing-library/react'
import { getAgentGraph } from '@/api/agentGraph'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { duplicateInspectedNode } from '../../NodeInspector'
import { findFieldControl, normalizeFieldPath } from '../sectionRequest'
import { addFixtureNodes, agentId, harness, renderInspector } from './inspectorTestHarness'

describe('NodeInspector requestedSection', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    await addFixtureNodes()
  })

  it('opens the action picker for "Change action" and focuses it', async () => {
    const { requestSection } = await renderInspector('send_whatsapp')
    expect(screen.queryByRole('listbox', { name: /actions/ })).not.toBeInTheDocument()

    requestSection('change-action')

    expect(await screen.findByRole('listbox', { name: /actions/ })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Change action/ }))
  })

  it('opens a closed section by key and focuses its first control', async () => {
    const { requestSection } = await renderInspector('add_to_crm')
    const toggle = screen.getByRole('button', { name: 'When this step fails' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    requestSection('on-error')

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Retries' })))
  })

  it('finds a field by its config path inside a closed section', async () => {
    const { requestSection } = await renderInspector('add_to_crm')
    const timeLimits = screen.getByRole('button', { name: 'Time limits' })
    expect(timeLimits).toHaveAttribute('aria-expanded', 'false')

    requestSection('config.timeout.read')

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Read' })))
    expect(timeLimits).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Advanced' }), 'sections without the field stay closed').toHaveAttribute('aria-expanded', 'false')
  })

  it('focuses a tagged template field and a schema form field', async () => {
    const crm = await renderInspector('add_to_crm')
    crm.requestSection('url')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'URL' })))
    crm.unmount()

    const maps = await renderInspector('search_maps')
    maps.requestSection('max_results')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Max results' })))
  })

  it('ignores a request for another node and handles each request once', async () => {
    const { requestSection } = await renderInspector('add_to_crm')
    requestSection('on-error', 'add_to_crm', 'search_maps')
    expect(screen.getByRole('button', { name: 'When this step fails' })).toHaveAttribute('aria-expanded', 'false')

    requestSection('on-error')
    const toggle = screen.getByRole('button', { name: 'When this step fails' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
    fireEvent.click(toggle)
    // Showing the same request again (any re-render) does not reopen the section.
    harness.controller?.setViewport({ x: 1, y: 1, zoom: 1 })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'))
  })

  it('reads config paths in several spellings', () => {
    expect(normalizeFieldPath('config.authorization.config.api_key')).toBe('authorization.config.api_key')
    expect(normalizeFieldPath('tool_parameters/city')).toBe('tool_parameters.city')
    const root = document.createElement('div')
    root.innerHTML = '<div data-field-path="tool_parameters"><input aria-label="whole" /></div><div data-field-path="tool_parameters.city"><input aria-label="city" /></div>'
    expect(findFieldControl(root, 'tool_parameters.city')?.getAttribute('aria-label')).toBe('city')
    expect(findFieldControl(root, 'tool_parameters.query.text')?.getAttribute('aria-label')).toBe('whole')
    expect(findFieldControl(root, 'nothing_here')).toBeNull()
  })
})

describe('Duplicate in the inspector', () => {
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    await addFixtureNodes()
  })

  it('copies a For each with its whole body, arrows and references', async () => {
    await renderInspector('for_each_place')
    const before = harness.controller?.graph
    const bodyBefore = before?.nodes.filter((node) => node.parent === 'for_each_place') ?? []
    expect(bodyBefore.length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))

    const graph = harness.controller?.graph
    const copy = graph?.nodes.find((node) => node.id === 'for_each_place_2')
    expect(copy).toMatchObject({ kind: 'iteration', parent: null })
    expect(copy?.displayTitle).toMatch(/\(copy\)$/)
    const copiedBody = graph?.nodes.filter((node) => node.parent === 'for_each_place_2') ?? []
    expect(copiedBody.map((node) => node.kind).sort()).toEqual(bodyBefore.map((node) => node.kind).sort())
    expect(copiedBody.some((node) => node.hidden), 'the body entry marker comes along').toBe(true)
    // References inside the copy point at the copied steps.
    expect(copy?.config.output_selector).toEqual(['send_whatsapp_2', 'data'])
    const copiedSend = graph?.nodes.find((node) => node.id === 'send_whatsapp_2')
    expect(copiedSend?.config.phone).toBe('{{#for_each_place_2.item.phone#}}')
    const innerArrows = graph?.edges.filter((edge) => copiedBody.some((node) => node.id === edge.source)) ?? []
    expect(innerArrows.length).toBeGreaterThan(0)
    expect(harness.controller?.pendingDescriptions.at(-1)).toContain('duplicated')
  })

  it('works as a pure edit: one step stays a single copy in its container', async () => {
    const graph = await getAgentGraph(agentId)
    const { graph: next, copyId } = duplicateInspectedNode(graph, 'write_message', {})
    expect(copyId).toBe('write_message_2')
    expect(next.nodes.find((node) => node.id === copyId)).toMatchObject({ parent: 'for_each_place', title: 'Write a short message (copy)' })
    expect(next.nodes.length).toBe(graph.nodes.length + 1)
  })
})
