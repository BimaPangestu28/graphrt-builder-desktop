import { describeDraftActivity, formatTokenCount } from './draftActivity'

describe('draft activity text', () => {
  it('formats token counts with thousands separators', () => {
    expect(formatTokenCount(0)).toBe('0 tokens')
    expect(formatTokenCount(1)).toBe('1 token')
    expect(formatTokenCount(412)).toBe('412 tokens')
    expect(formatTokenCount(12480)).toBe('12,480 tokens')
    expect(formatTokenCount(1234567.4)).toBe('1,234,567 tokens')
  })

  it('says Writing while drafting and Fixing while repairing', () => {
    expect(describeDraftActivity('drafting', 412)).toBe('Writing… 412 tokens')
    expect(describeDraftActivity('repairing', 1204)).toBe('Fixing… 1,204 tokens')
  })
})
