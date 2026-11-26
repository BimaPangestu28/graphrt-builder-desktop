import { decimateIndices, effectiveChartType, foldSlices, labelStep, niceDomain, pieSlices, stackSeries, valueExtent } from '../chart/chartModel'
import type { ChartBlock } from '../uiBlockTypes'

const bar = (values: Array<number | null>[], extra: Partial<ChartBlock> = {}): ChartBlock => ({
  $ui: 'chart',
  version: 1,
  type: 'bar',
  x: { values: values[0].map((_, index) => `c${index}`) },
  series: values.map((seriesValues, index) => ({ name: `s${index}`, values: seriesValues })),
  ...extra,
})

describe('niceDomain', () => {
  it('includes zero and ends on round ticks', () => {
    expect(niceDomain(12, 87)).toEqual({ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] })
    expect(niceDomain(-30, 45).ticks).toEqual([-40, -20, 0, 20, 40, 60])
  })

  it('keeps the block min and max', () => {
    const domain = niceDomain(10, 50, 5, { min: 5, max: 55 })
    expect([domain.min, domain.max]).toEqual([5, 55])
    expect(domain.ticks[0]).toBeGreaterThanOrEqual(5)
  })

  it('survives a flat series', () => {
    expect(niceDomain(0, 0).max).toBeGreaterThan(0)
  })
})

describe('stackSeries', () => {
  it('stacks positives up and negatives down, nulls stay gaps', () => {
    expect(stackSeries([[1, -2, null], [3, -1, 4]])).toEqual([
      [[0, 1], [0, -2], null],
      [[1, 4], [-2, -3], [0, 4]],
    ])
  })

  it('stack totals drive the extent', () => {
    const block = bar([[1, 2], [3, 4]], { stacked: true })
    expect(valueExtent(block, stackSeries(block.series.map((series) => series.values)))).toEqual([0, 6])
    expect(valueExtent(block, null)).toEqual([1, 4])
  })
})

describe('decimateIndices', () => {
  it('keeps every point that fits', () => {
    expect(decimateIndices([[1, 2, 3]], 10)).toEqual([0, 1, 2])
  })

  it('keeps peaks and dips of every series when thinning', () => {
    const spiky = Array.from({ length: 10000 }, (_, index) => (index === 4321 ? 999 : index === 777 ? -999 : 1))
    const kept = decimateIndices([spiky], 400)
    expect(kept.length).toBeLessThanOrEqual(500)
    expect(kept).toContain(4321)
    expect(kept).toContain(777)
    expect(kept[0]).toBe(0)
    expect(kept.at(-1)).toBe(9999)
  })
})

describe('pie slices', () => {
  it('shares add up and zero slices are skipped', () => {
    const slices = pieSlices([1, 0, 3], 50, 30)
    expect(slices.map((slice) => slice.index)).toEqual([0, 2])
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1)
    expect(slices[0].path.startsWith('M')).toBe(true)
  })

  it('folds small slices into Other past eight', () => {
    const labels = Array.from({ length: 10 }, (_, index) => `l${index}`)
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
    const folded = foldSlices(labels, values, 'Other')
    expect(folded.labels).toEqual(['l0', 'l2', 'l4', 'l6', 'l7', 'l8', 'l9', 'Other'])
    expect(folded.values.reduce((sum, value) => sum + value, 0)).toBe(55)
  })
})

describe('layout helpers', () => {
  it('skips labels that would overlap', () => {
    expect(labelStep(12, 600, 40)).toBe(1)
    expect(labelStep(365, 600, 40)).toBe(25)
  })

  it('draws very dense bar charts as areas', () => {
    expect(effectiveChartType(bar([Array.from({ length: 2000 }, () => 1)]))).toBe('area')
    expect(effectiveChartType(bar([[1, 2]]))).toBe('bar')
  })
})
