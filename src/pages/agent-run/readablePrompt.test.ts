import { readablePrompt } from './readablePrompt'

describe('readablePrompt', () => {
  it('turns the invoice a step shows as one line of JSON into an outline', () => {
    const prompt = [
      'Nomor: INV-2026-0001',
      'Folder: {YYYY}/{MM}',
      '',
      'Isi invoice:',
      '{"number":"INV-2026-0001","date":"2026-11-27","currency":"IDR","seller":{"name":"CV Kenanga Digital"},"client":{"name":"PT Maju Bersama"},"items":[{"description":"Desain antarmuka","quantity":3,"unit":"hari","unit_price":1500000},{"description":"Lisensi server","quantity":1,"unit_price":2400000}],"taxes":[{"name":"PPN","rate":11}]}',
    ].join('\n')

    expect(readablePrompt(prompt)).toBe(
      [
        'Nomor: INV-2026-0001',
        'Folder: {YYYY}/{MM}',
        '',
        'Isi invoice:',
        'Number: INV-2026-0001',
        'Date: 2026-11-27',
        'Currency: IDR',
        'Seller: CV Kenanga Digital',
        'Client: PT Maju Bersama',
        'Items:',
        '  1. Desain antarmuka · quantity 3 · unit hari · unit price 1500000',
        '  2. Lisensi server · quantity 1 · unit price 2400000',
        'Taxes:',
        '  1. PPN · rate 11',
      ].join('\n'),
    )
  })

  it('reads JSON that follows a label on the same line', () => {
    expect(readablePrompt('Kirim ke: {"name":"Sari","phone":"+62 812"}')).toBe('Kirim ke:\nName: Sari\nPhone: +62 812')
    expect(readablePrompt('Tags: ["a","b"]')).toBe('Tags:\n1. a\n2. b')
  })

  it('leaves ordinary text, patterns in braces and broken JSON as written', () => {
    for (const text of ['Send this message to Kopi Kenangan?', 'Folder: {YYYY}/{MM}', 'Pola: {number}', '{"number": ', 'Total: 3 [approx]', '']) {
      expect(readablePrompt(text)).toBe(text)
    }
  })

  it('shows empty and nested values without brackets', () => {
    expect(readablePrompt('{"due":null,"paid":false,"contact":{"name":"Sari","emails":["a@x.test","b@x.test"]}}')).toBe(
      'Due: -\nPaid: false\nContact: Sari · emails a@x.test, b@x.test',
    )
  })
})
