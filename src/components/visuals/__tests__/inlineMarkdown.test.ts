import { isSafeCardLink, parseCardMarkdown, parseInline } from '../adaptive-card/inlineMarkdown'

describe('card markdown', () => {
  it('parses bold, italic and links into tokens', () => {
    expect(parseInline('Pay **Rp 250.000** _today_ via [the shop](https://shop.example.com)')).toEqual([
      { kind: 'text', text: 'Pay ', bold: false, italic: false },
      { kind: 'text', text: 'Rp 250.000', bold: true, italic: false },
      { kind: 'text', text: ' ', bold: false, italic: false },
      { kind: 'text', text: 'today', bold: false, italic: true },
      { kind: 'text', text: ' via ', bold: false, italic: false },
      { kind: 'link', text: 'the shop', url: 'https://shop.example.com', bold: false, italic: false },
    ])
  })

  it('keeps underscores inside words and unmatched markers as text', () => {
    expect(parseInline('order_id is **open')).toEqual([{ kind: 'text', text: 'order_id is **open', bold: false, italic: false }])
  })

  it('treats HTML as plain text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>', bold: false, italic: false }])
  })

  it('groups list lines', () => {
    const parts = parseCardMarkdown('Steps:\n- pack\n- ship\n1. pay\n2. confirm')
    expect(parts.map((part) => part.kind)).toEqual(['paragraph', 'bullets', 'numbered'])
    expect(parts[1]).toMatchObject({ items: [[{ text: 'pack' }], [{ text: 'ship' }]] })
  })

  it('only https and mailto links are live', () => {
    expect(isSafeCardLink('https://example.com/a')).toBe(true)
    expect(isSafeCardLink('mailto:a@example.com')).toBe(true)
    expect(isSafeCardLink('javascript:alert(1)')).toBe(false)
    expect(isSafeCardLink('http://example.com')).toBe(false)
    expect(isSafeCardLink('https://user@evil.example')).toBe(false)
  })
})
