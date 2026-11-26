import { formatValue } from '../format'
import { buildStatTile } from '../stats/statsModel'
import { cellAlignment, formatCell } from '../table/TableView'

describe('number formats', () => {
  it('writes each format in the app language (English)', () => {
    expect(formatValue(12.5, { format: 'percent' })).toBe('12.5%')
    expect(formatValue(1840, { format: 'compact' })).toBe('1.8K')
    expect(formatValue(125000000, { format: 'currency', currency: 'IDR' })).toMatch(/IDR\s?125,000,000/)
    expect(formatValue(1250000, {}, true)).toBe('1.3M')
    expect(formatValue(1234.567)).toBe('1,234.57')
  })
})

describe('stat tiles', () => {
  it('colours a change by whether it is good news and says the direction', () => {
    expect(buildStatTile({ label: 'Revenue', value: 100, delta: 12.5, delta_format: 'percent' }).delta).toEqual({ text: '+12.5%', trend: 'up', tone: 'good', spoken: 'up 12.5%' })
    expect(buildStatTile({ label: 'Refunds', value: 7, delta: -2, good: 'down' }).delta?.tone).toBe('good')
    expect(buildStatTile({ label: 'Orders', value: 9, delta: -3 }).delta?.tone).toBe('bad')
    expect(buildStatTile({ label: 'Flat', value: 1, delta: 0 }).delta?.tone).toBe('neutral')
    expect(buildStatTile({ label: 'Status', value: 'Healthy' }).delta).toBeNull()
  })
})

describe('table cells', () => {
  it('aligns numbers right and formats them', () => {
    const rows = [{ units: 3, name: 'a' }]
    expect(cellAlignment({ key: 'units', label: 'Units' }, rows)).toBe('right')
    expect(cellAlignment({ key: 'name', label: 'Name' }, rows)).toBe('left')
    expect(formatCell(31250000, { key: 'r', label: 'R', format: 'currency', currency: 'IDR' })).toMatch(/31,250,000/)
    expect(formatCell(true, { key: 'b', label: 'B' })).toBe('Yes')
    expect(formatCell(null, { key: 'b', label: 'B' })).toBe('')
  })
})
