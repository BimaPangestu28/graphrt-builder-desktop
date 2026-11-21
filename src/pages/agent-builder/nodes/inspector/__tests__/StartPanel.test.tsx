import { act, fireEvent, screen, within } from '@testing-library/react'
import { resetSampleAgentGraphs } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { readStartVariables } from '../startInputs'
import { currentNode, harness, renderInspector } from './inspectorTestHarness'

const startId = 'ask_input'

function commitText(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

const names = () => readStartVariables(currentNode(startId).config).map((variable) => variable.variable)
const inputRows = () => within(screen.getByRole('list', { name: 'Inputs' })).getAllByRole('listitem')

describe('Start inputs editor', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleAgentGraphs()
  })

  it('shows each input as a row with its label, type, required and where it is used, not JSON', async () => {
    await renderInspector(startId)
    expect(inputRows()).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: 'Label of input 1' })).toHaveValue('Keyword')
    expect(screen.getByRole('combobox', { name: 'Type of Keyword' })).toHaveValue('text-input')
    expect(screen.getByRole('checkbox', { name: 'Keyword is required' })).toBeChecked()
    expect(within(inputRows()[0]).getByText(/Used by 1 step$/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Variables/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit as JSON' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('adds an input whose name follows its label', async () => {
    await renderInspector(startId)
    fireEvent.click(screen.getByRole('button', { name: 'Add an input' }))
    expect(names()).toEqual(['keyword', 'city', 'offer', 'input'])
    commitText(screen.getByRole('textbox', { name: 'Label of input 4' }), 'Max results')
    expect(readStartVariables(currentNode(startId).config)[3]).toEqual({ variable: 'max_results', label: 'Max results', type: 'text-input', required: false })
  })

  it('renames a variable and updates the steps that read it in one undo step', async () => {
    await renderInspector(startId)
    fireEvent.click(screen.getByRole('button', { name: 'Show options of City' }))
    const nameInput = screen.getByRole('textbox', { name: 'Variable name' })
    commitText(nameInput, 'bad name')
    expect(screen.getByRole('alert')).toHaveTextContent(/no spaces or dots/)
    expect(names()).toContain('city')
    commitText(nameInput, 'town')
    expect(names()).toEqual(['keyword', 'town', 'offer'])
    expect(currentNode('search_maps').config.query).toBe('{{#ask_input.keyword#}} in {{#ask_input.town#}}')
    act(() => harness.controller?.undo())
    expect(names()).toEqual(['keyword', 'city', 'offer'])
    expect(currentNode('search_maps').config.query).toBe('{{#ask_input.keyword#}} in {{#ask_input.city#}}')
  })

  it('reorders with the arrow keys on the handle', async () => {
    await renderInspector(startId)
    const handle = screen.getByRole('button', { name: 'Reorder Offer' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(names()).toEqual(['keyword', 'offer', 'city'])
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Offer' }), { key: 'ArrowUp' })
    expect(names()).toEqual(['offer', 'keyword', 'city'])
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Offer' }), { key: 'ArrowUp' })
    expect(names()).toEqual(['offer', 'keyword', 'city'])
  })

  it('warns before deleting an input that steps use, and can keep it', async () => {
    await renderInspector(startId)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Offer' }))
    const warning = screen.getByRole('alertdialog', { name: 'Delete Offer?' })
    expect(warning).toHaveTextContent('Write a short message uses this input')
    fireEvent.click(within(warning).getByRole('button', { name: 'Keep it' }))
    expect(names()).toEqual(['keyword', 'city', 'offer'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete Offer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }))
    expect(names()).toEqual(['keyword', 'city'])
  })

  it('deletes an unused input right away and duplicates one', async () => {
    await renderInspector(startId)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate City' }))
    expect(names()).toEqual(['keyword', 'city', 'city_2', 'offer'])
    expect(readStartVariables(currentNode(startId).config)[2]).toMatchObject({ label: 'City (copy)', required: true })
    fireEvent.click(screen.getByRole('button', { name: 'Delete City (copy)' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(names()).toEqual(['keyword', 'city', 'offer'])
  })

  it('gives the default value an input that matches the type', async () => {
    await renderInspector(startId)
    fireEvent.change(screen.getByRole('combobox', { name: 'Type of Offer' }), { target: { value: 'number' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show options of Offer' }))
    commitText(screen.getByRole('spinbutton', { name: 'Default value' }), '7')
    expect(readStartVariables(currentNode(startId).config)[2]).toMatchObject({ type: 'number', default: 7 })

    fireEvent.change(screen.getByRole('combobox', { name: 'Type of Offer' }), { target: { value: 'select' } })
    expect(readStartVariables(currentNode(startId).config)[2]).toEqual({ variable: 'offer', label: 'Offer', required: true, type: 'select', options: ['Option 1'] })
    fireEvent.click(screen.getByRole('button', { name: 'Add a choice' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Default choice' }), { target: { value: 'Option 2' } })
    expect(readStartVariables(currentNode(startId).config)[2]).toMatchObject({ options: ['Option 1', 'Option 2'], default: 'Option 2' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Type of Offer' }), { target: { value: 'checkbox' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Checked by default' }))
    expect(readStartVariables(currentNode(startId).config)[2]).toEqual({ variable: 'offer', label: 'Offer', required: true, type: 'checkbox', default: true })
    expect(harness.controller?.pendingDescriptions.at(-1)).toContain('on ')
  })
})
