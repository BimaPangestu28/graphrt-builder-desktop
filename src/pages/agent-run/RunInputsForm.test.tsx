import { fireEvent, render, screen, within } from '@testing-library/react'
import type { RunInputs } from '@/api/runReviewTypes'
import type { FlowInput } from '@/api/types'
import { RunInputsForm } from './RunInputsForm'

const itemsInput: FlowInput = {
  name: 'items',
  label: 'Invoice items',
  required: true,
  inputType: 'json',
  defaultValue: [{ description: 'Desain antarmuka', quantity: 3, unit: 'hari', unit_price: 1500000 }],
}

function renderForm(inputs: FlowInput[] = [itemsInput]) {
  const started: RunInputs[] = []
  render(<RunInputsForm inputs={inputs} lastInputs={null} isStarting={false} onStart={(runInputs) => started.push(runInputs)} />)
  return started
}

function type(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } })
}

describe('a list input in the test form', () => {
  it('is filled in row by row and sent as a list with numbers', () => {
    const started = renderForm()
    const group = screen.getByRole('group', { name: 'Invoice items' })
    expect(within(group).queryByRole('textbox', { name: 'Invoice items' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('Desain antarmuka')

    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }))
    type('Description, row 2', 'Lisensi server')
    type('Quantity, row 2', '1')
    type('Unit price, row 2', '2400000')
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }))
    type('Description, row 3', 'Pelatihan')
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start the test' }))

    expect(started).toEqual([
      {
        items: [
          { description: 'Desain antarmuka', quantity: 3, unit: 'hari', unit_price: 1500000 },
          { description: 'Lisensi server', quantity: 1, unit_price: 2400000 },
        ],
      },
    ])
  })

  it('says which cell is not a number and does not start', () => {
    const started = renderForm()
    type('Quantity, row 1', 'tiga')
    expect(screen.getByText('Invoice items, row 1: Quantity must be a number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the test' })).toBeDisabled()
    expect(started).toEqual([])
  })

  it('can be edited as text and shown as rows again', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Edit as text' }))
    const textBox = screen.getByLabelText('Invoice items')
    expect(JSON.parse((textBox as HTMLTextAreaElement).value)).toEqual(itemsInput.defaultValue)
    // Nested data is not a row: the way back is offered only for a list of simple records.
    fireEvent.change(textBox, { target: { value: '[{"description":"x","tags":["a"]}]' } })
    expect(screen.queryByRole('button', { name: 'Show as rows' })).not.toBeInTheDocument()
    fireEvent.change(textBox, { target: { value: '[{"description":"Pelatihan","quantity":2}]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show as rows' }))
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('Pelatihan')
  })

  it('keeps other JSON inputs as a text box', () => {
    renderForm([{ name: 'extra', label: 'Extra data', required: false, inputType: 'json', defaultValue: { seller: { name: 'CV Kenanga' } } }])
    expect(screen.getByLabelText('Extra data (optional)')).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.queryByRole('button', { name: 'Add a row' })).not.toBeInTheDocument()
  })
})
