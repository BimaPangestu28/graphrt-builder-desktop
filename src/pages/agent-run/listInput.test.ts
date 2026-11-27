import type { FlowInput } from '@/api/types'
import { emptyRow, listColumns, rowsFromValue, valueFromRows } from './listInput'
import { initialRunInputValues, isListRowsState, jsonTextToListRows, listRowsToJsonText, parseRunInputValues, runInputLabel } from './runInputValues'

const invoiceItems = [
  { description: 'Desain antarmuka', quantity: 3, unit: 'hari', unit_price: 1500000 },
  { description: 'Lisensi server', quantity: 1, unit_price: 2400000 },
]

const itemsInput: FlowInput = { name: 'items', label: 'Daftar item', required: true, inputType: 'json', defaultValue: invoiceItems }

describe('listColumns', () => {
  it('takes the columns from the keys of the records, numbers as numbers', () => {
    expect(listColumns(undefined, invoiceItems)).toEqual([
      { key: 'description', label: 'Description', kind: 'text' },
      { key: 'quantity', label: 'Quantity', kind: 'number' },
      { key: 'unit', label: 'Unit', kind: 'text' },
      { key: 'unit_price', label: 'Unit price', kind: 'number' },
    ])
    expect(listColumns(undefined, [{ name: 'Sari', active: true }])?.[1]).toEqual({ key: 'active', label: 'Active', kind: 'checkbox' })
  })

  it('takes the columns from a schema, also for an empty list', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { description: { type: 'string', title: 'What' }, quantity: { type: 'integer' }, paid: { type: 'boolean' } } } }
    expect(listColumns(schema, null)).toEqual([
      { key: 'description', label: 'What', kind: 'text' },
      { key: 'quantity', label: 'Quantity', kind: 'number' },
      { key: 'paid', label: 'Paid', kind: 'checkbox' },
    ])
    // A record with a key the schema does not have would lose it as rows.
    expect(listColumns(schema, [{ description: 'x', note: 'y' }])).toBeNull()
  })

  it('leaves every other shape as JSON', () => {
    const unrecognised: unknown[] = [
      null,
      [],
      'text',
      { description: 'one record, not a list' },
      ['a', 'b'],
      [{ description: 'x', tags: ['a'] }],
      [{ description: 'x', seller: { name: 'y' } }],
      [{ amount: 3 }, { amount: 'three' }],
      [{ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }],
      [{}],
    ]
    for (const value of unrecognised) expect(listColumns(undefined, value)).toBeNull()
    expect(listColumns({ type: 'array', items: { type: 'object', properties: { tags: { type: 'array' } } } }, null)).toBeNull()
    expect(listColumns({ type: 'object' }, null)).toBeNull()
  })
})

describe('rows and values', () => {
  const columns = listColumns(undefined, invoiceItems) ?? []

  it('shows a record as text cells and reads them back as the same record', () => {
    const rows = rowsFromValue(columns, invoiceItems)
    expect(rows).toEqual([
      { description: 'Desain antarmuka', quantity: '3', unit: 'hari', unit_price: '1500000' },
      { description: 'Lisensi server', quantity: '1', unit: '', unit_price: '2400000' },
    ])
    expect(valueFromRows(columns, rows)).toEqual({ records: invoiceItems, invalidNumbers: [] })
  })

  it('sends numbers as numbers, leaves empty cells out and drops rows nobody filled in', () => {
    const rows = [{ description: ' Pelatihan ', quantity: '2.5', unit: '', unit_price: '' }, emptyRow(columns), { description: '', quantity: ' ', unit: '', unit_price: '' }]
    expect(valueFromRows(columns, rows).records).toEqual([{ description: 'Pelatihan', quantity: 2.5 }])
  })

  it('names the cell that is not a number', () => {
    const rows = [emptyRow(columns), { description: 'Desain', quantity: 'tiga', unit: '', unit_price: '10' }]
    expect(valueFromRows(columns, rows).invalidNumbers).toEqual([{ rowNumber: 1, label: 'Quantity' }])
  })

  it('keeps a checkbox as true or false', () => {
    const checkColumns = listColumns(undefined, [{ name: 'Sari', active: true }]) ?? []
    expect(valueFromRows(checkColumns, [{ name: 'Budi', active: false }]).records).toEqual([{ name: 'Budi', active: false }])
    expect(valueFromRows(checkColumns, [emptyRow(checkColumns)]).records).toEqual([])
  })
})

describe('a list input in the run form', () => {
  it('starts as rows and becomes the list the run gets', () => {
    const values = initialRunInputValues([itemsInput], null)
    const state = values.items
    expect(isListRowsState(state) && state.rows.length).toBe(2)
    expect(parseRunInputValues([itemsInput], values)).toEqual({ inputs: { items: invoiceItems }, problems: [] })
  })

  it('keeps a column of the default that the last run left empty', () => {
    const values = initialRunInputValues([itemsInput], { items: [{ description: 'Pelatihan', quantity: 2 }] })
    const state = values.items
    expect(isListRowsState(state) && state.columns.map((column) => column.key)).toEqual(['description', 'quantity', 'unit', 'unit_price'])
    expect(isListRowsState(state) && state.rows).toEqual([{ description: 'Pelatihan', quantity: '2', unit: '', unit_price: '' }])
  })

  it('blocks the start on a bad number and on a required list without rows', () => {
    const values = initialRunInputValues([itemsInput], null)
    const state = values.items
    if (!isListRowsState(state)) throw new Error('expected rows')
    const badNumber = { ...state, rows: [{ ...state.rows[0], quantity: 'tiga' }] }
    expect(parseRunInputValues([itemsInput], { items: badNumber }).problems).toEqual(['Daftar item, row 1: Quantity must be a number'])
    expect(parseRunInputValues([itemsInput], { items: { ...state, rows: [] } }).problems).toEqual(['Add at least one row to Daftar item'])
    const optional = { ...itemsInput, required: false }
    expect(parseRunInputValues([optional], { items: { ...state, rows: [] } })).toEqual({ inputs: {}, problems: [] })
  })

  it('leaves JSON that is not a list of records as text', () => {
    const settings: FlowInput = { name: 'settings', label: 'Settings', required: false, inputType: 'json', defaultValue: { seller: { name: 'CV Kenanga' } } }
    const values = initialRunInputValues([settings], null)
    expect(typeof values.settings).toBe('string')
    expect(parseRunInputValues([settings], values).inputs).toEqual({ settings: { seller: { name: 'CV Kenanga' } } })
  })

  it('goes to JSON text and back', () => {
    const state = initialRunInputValues([itemsInput], null).items
    if (!isListRowsState(state)) throw new Error('expected rows')
    const jsonText = listRowsToJsonText(state)
    expect(JSON.parse(jsonText)).toEqual(invoiceItems)
    expect(jsonTextToListRows(itemsInput, jsonText)).toEqual(state)
    expect(jsonTextToListRows(itemsInput, '[{"description": ')).toBeNull()
    expect(jsonTextToListRows(itemsInput, '{"not":"a list"}')).toBeNull()
  })
})

describe('runInputLabel', () => {
  const input = (label: string, required: boolean): FlowInput => ({ name: 'x', label, required })

  it('marks an input that may stay empty, once', () => {
    expect(runInputLabel(input('Client name', true))).toBe('Client name')
    expect(runInputLabel(input('Tax name', false))).toBe('Tax name (optional)')
    expect(runInputLabel(input('Client address (optional)', false))).toBe('Client address (optional)')
    expect(runInputLabel(input('Alamat klien (opsional)', false))).toBe('Alamat klien (opsional)')
    expect(runInputLabel(input('Tax percent (leave empty for no tax)', false))).toBe('Tax percent (leave empty for no tax) (optional)')
  })
})
