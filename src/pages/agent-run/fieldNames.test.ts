import { setLocale } from '@/i18n'
import type { FlowInput } from '@/api/types'
import { fieldName } from './fieldNames'
import { listColumns } from './listInput'
import { readablePrompt } from './readablePrompt'
import { runInputLabel } from './runInputValues'

describe('data keys in the words of the app', () => {
  afterEach(() => setLocale('en'))

  it('reads a key as words, however it is written', () => {
    expect(fieldName('unit_price')).toBe('unit price')
    expect(fieldName('unitPrice')).toBe('unit price')
    expect(fieldName('Unit-Price')).toBe('unit price')
    expect(fieldName('delivery_window')).toBe('delivery window')
  })

  it('names common business keys in Indonesian and leaves the others as written', () => {
    setLocale('id')
    expect(fieldName('unit_price')).toBe('harga satuan')
    expect(fieldName('Quantity')).toBe('jumlah')
    expect(fieldName('delivery_window')).toBe('delivery window')
  })

  it('heads the columns of a list input in Indonesian', () => {
    setLocale('id')
    const columns = listColumns(undefined, [{ description: 'Jasa konsultasi', quantity: 8, unit: 'jam', unit_price: 350000 }])
    expect(columns?.map((column) => column.label)).toEqual(['Deskripsi', 'Jumlah', 'Satuan', 'Harga satuan'])
  })

  it('keeps a title the workflow gives a column', () => {
    setLocale('id')
    const schema = { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number', title: 'Banyaknya' } } } }
    expect(listColumns(schema, null)?.[0].label).toBe('Banyaknya')
  })

  it('writes the data of an approval in Indonesian', () => {
    setLocale('id')
    expect(readablePrompt('Item: [{"description":"Jasa konsultasi","quantity":8,"unit":"jam","unit_price":350000}]')).toBe(
      'Item:\n1. Jasa konsultasi · jumlah 8 · satuan jam · harga satuan 350000',
    )
  })

  it('marks an optional input in the language of the app, once', () => {
    const input = (label: string): FlowInput => ({ name: 'x', label, required: false })
    setLocale('id')
    expect(runInputLabel(input('Nama pajak'))).toBe('Nama pajak (opsional)')
    expect(runInputLabel(input('Alamat klien (opsional)'))).toBe('Alamat klien (opsional)')
    expect(runInputLabel(input('Client address (Optional)'))).toBe('Client address (Optional)')
  })
})
