import type { ChartBlock } from '../uiBlockTypes'

/**
 * Geometry of a chart block, independent of React: value domain and ticks, stacking, which points to draw
 * when a line has more points than pixels, and pie slices. Everything here is pure so it is tested directly
 * and memoized by the view.
 */

/** Categorical colour slots, in fixed order (validated light/dark palette, see index.css `--color-series-*`). */
export const SERIES_SLOTS = 8

/** Bars drawn at most (categories × series); denser bar charts are drawn as an area chart instead. */
export const MAX_BARS = 1500

export interface Domain {
  min: number
  max: number
  ticks: number[]
}

/** 1, 2, 2.5 or 5 times a power of ten, at or above `rough`. */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * power
}

/**
 * A value axis that includes zero (bars and areas start at the baseline) and ends on round ticks.
 *
 * @param low - Smallest value to show (number)
 * @param high - Largest value to show (number)
 * @param tickCount - About how many ticks (number)
 * @param fixed - The block's `y.min` / `y.max`, which win (object)
 * @returns Domain and ticks, ascending (Domain)
 */
export function niceDomain(low: number, high: number, tickCount = 5, fixed: { min?: number; max?: number } = {}): Domain {
  let min = fixed.min ?? Math.min(0, low)
  let max = fixed.max ?? Math.max(0, high)
  if (min === max) max = min + 1
  const step = niceStep((max - min) / tickCount)
  if (fixed.min === undefined) min = Math.floor(min / step) * step
  if (fixed.max === undefined) max = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let tick = Math.ceil(min / step) * step; tick <= max + step / 1e6; tick += step) ticks.push(Number(tick.toPrecision(12)))
  return { min, max, ticks }
}

/** One series' values stacked on the ones before it: `[base, top]` per category (null stays null). */
export type StackedSeries = Array<[number, number] | null>

/**
 * Stacks series: positive values grow up from the previous positive total, negative ones down.
 *
 * @param series - Values per series (Array<Array<number | null>>)
 * @returns `[base, top]` per series and category (StackedSeries[])
 */
export function stackSeries(series: Array<Array<number | null>>): StackedSeries[] {
  const categoryCount = series[0]?.length ?? 0
  const positive = new Array<number>(categoryCount).fill(0)
  const negative = new Array<number>(categoryCount).fill(0)
  return series.map((values) =>
    values.map((value, index) => {
      if (value === null) return null
      const totals = value >= 0 ? positive : negative
      const base = totals[index]
      totals[index] = base + value
      return [base, base + value] as [number, number]
    }),
  )
}

/** Smallest and largest value the chart draws (stack totals when stacked). */
export function valueExtent(block: ChartBlock, stacked: StackedSeries[] | null): [number, number] {
  let low = Infinity
  let high = -Infinity
  const visit = (value: number) => {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  if (stacked) stacked.flat().forEach((segment) => segment && segment.forEach(visit))
  else block.series.forEach((series) => series.values.forEach((value) => value !== null && visit(value)))
  return low === Infinity ? [0, 1] : [low, high]
}

/**
 * Which category indices a line or area draws when it has more points than `maxPoints`: per bucket the first
 * and last index and, for every series, the index of its minimum and maximum, so peaks and dips survive.
 *
 * @param series - Values per series (Array<Array<number | null>>)
 * @param maxPoints - About how many points fit (number)
 * @returns Ascending indices; every index when they all fit (number[])
 */
export function decimateIndices(series: Array<Array<number | null>>, maxPoints: number): number[] {
  const count = series[0]?.length ?? 0
  const all = Array.from({ length: count }, (_, index) => index)
  const bucketCount = Math.max(1, Math.floor(maxPoints / 4))
  if (count <= maxPoints) return all
  const bucketSize = Math.ceil(count / bucketCount)
  const kept = new Set<number>()
  for (let start = 0; start < count; start += bucketSize) {
    const end = Math.min(count, start + bucketSize) - 1
    kept.add(start).add(end)
    for (const values of series) {
      let minIndex = -1
      let maxIndex = -1
      for (let index = start; index <= end; index += 1) {
        const value = values[index]
        if (value === null) continue
        if (minIndex < 0 || value < (values[minIndex] as number)) minIndex = index
        if (maxIndex < 0 || value > (values[maxIndex] as number)) maxIndex = index
      }
      if (minIndex >= 0) kept.add(minIndex).add(maxIndex)
    }
  }
  return [...kept].sort((first, second) => first - second)
}

/**
 * Every `step`-th category label fits without overlapping: labels need about `labelWidth` pixels.
 *
 * @returns 1 when every label fits (number)
 */
export function labelStep(categoryCount: number, plotWidth: number, labelWidth: number): number {
  if (categoryCount <= 1 || plotWidth <= 0) return 1
  return Math.max(1, Math.ceil((categoryCount * labelWidth) / plotWidth))
}

export interface PieSlice {
  index: number
  value: number
  share: number
  /** SVG path of the slice (or ring segment). */
  path: string
}

function polar(centerX: number, centerY: number, radius: number, angle: number): [number, number] {
  return [centerX + radius * Math.sin(angle), centerY - radius * Math.cos(angle)]
}

/**
 * Pie or donut slices, clockwise from 12 o'clock. Zero values get no slice; a single full slice is drawn as
 * two halves so the arc is valid.
 *
 * @param values - One value per category, 0 or more (number[])
 * @param radius - Outer radius (number)
 * @param innerRadius - 0 for a pie (number)
 * @returns Slices with their share of the total (PieSlice[])
 */
export function pieSlices(values: number[], radius: number, innerRadius: number, center: [number, number] = [radius, radius]): PieSlice[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return []
  const [centerX, centerY] = center
  const arc = (from: number, to: number) => {
    const large = to - from > Math.PI ? 1 : 0
    const [x1, y1] = polar(centerX, centerY, radius, from)
    const [x2, y2] = polar(centerX, centerY, radius, to)
    if (innerRadius <= 0) return `M${centerX},${centerY}L${x1},${y1}A${radius},${radius} 0 ${large} 1 ${x2},${y2}Z`
    const [x3, y3] = polar(centerX, centerY, innerRadius, to)
    const [x4, y4] = polar(centerX, centerY, innerRadius, from)
    return `M${x1},${y1}A${radius},${radius} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${innerRadius},${innerRadius} 0 ${large} 0 ${x4},${y4}Z`
  }
  const slices: PieSlice[] = []
  let angle = 0
  values.forEach((value, index) => {
    if (value <= 0) return
    const sweep = (value / total) * Math.PI * 2
    const path = sweep >= Math.PI * 2 - 1e-9 ? `${arc(0, Math.PI)}${arc(Math.PI, Math.PI * 2 - 1e-6)}` : arc(angle, angle + sweep)
    slices.push({ index, value, share: value / total, path })
    angle += sweep
  })
  return slices
}

/** How the view draws a block: bar charts too dense for bars become areas. */
export function effectiveChartType(block: ChartBlock): ChartBlock['type'] {
  if (block.type === 'bar' && block.x.values.length * block.series.length > MAX_BARS) return 'area'
  return block.type
}

/**
 * The colour slot (1-based `--color-series-N`) of a series. Colours follow the series' position in the block,
 * never its rank. Past 8 series the slots repeat, and the view adds a second encoding (dashed lines, lighter
 * bars) so identity is never colour alone.
 */
export function seriesSlot(index: number): number {
  return (index % SERIES_SLOTS) + 1
}

/** Whether a series reuses a colour slot and needs the second encoding. */
export function isRepeatedSlot(index: number): boolean {
  return index >= SERIES_SLOTS
}

/**
 * Pie and donut slices beyond the 7 largest are folded into one "Other" slice, so the 8 colours never repeat.
 *
 * @param labels - Category labels (string[])
 * @param values - One value per category (number[])
 * @param otherLabel - Label of the folded slice (string)
 * @returns Labels and values in the original order, "Other" last (object)
 */
export function foldSlices(labels: string[], values: number[], otherLabel: string): { labels: string[]; values: number[] } {
  if (values.length <= SERIES_SLOTS) return { labels, values }
  const keep = new Set(
    values
      .map((value, index) => ({ value, index }))
      .sort((first, second) => second.value - first.value)
      .slice(0, SERIES_SLOTS - 1)
      .map((entry) => entry.index),
  )
  const kept = values.map((value, index) => ({ value, index })).filter((entry) => keep.has(entry.index))
  const other = values.reduce((sum, value, index) => (keep.has(index) ? sum : sum + value), 0)
  return { labels: [...kept.map((entry) => labels[entry.index]), otherLabel], values: [...kept.map((entry) => entry.value), other] }
}
