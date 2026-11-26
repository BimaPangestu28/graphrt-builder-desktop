import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { messages } from '@/i18n'
import { formatValue, type ValueFormat } from '../format'
import { useElementWidth } from '../useElementWidth'
import type { ChartBlock } from '../uiBlockTypes'
import {
  decimateIndices,
  effectiveChartType,
  foldSlices,
  isRepeatedSlot,
  labelStep,
  niceDomain,
  pieSlices,
  seriesSlot,
  stackSeries,
  valueExtent,
  type Domain,
  type StackedSeries,
} from './chartModel'

/**
 * SVG chart for a `chart` block: bar (grouped, stacked, horizontal), line, area (stacked) and pie / donut.
 * Thin marks, rounded data ends on the baseline, a recessive grid, a legend for two or more series, a hover
 * tooltip per category or slice, and a table view (the accessible and exact reading). Colours come from the
 * `--color-series-N` tokens in a fixed order; text always uses the text inks.
 */

const plotHeight = 260
const roundHeight = 220
const margin = { top: 12, right: 16, bottom: 30 }
const axisLabelChars = 6
const pixelsPerChar = 7
const horizontalLabelWidth = 132
const markerLimit = 40

const seriesColor = (index: number) => `var(--color-series-${seriesSlot(index)})`

function categoryLabel(value: string | number): string {
  return typeof value === 'number' ? formatValue(value) : value
}

interface Hover {
  index: number
  /** Pointer position inside the chart box, for the tooltip. */
  x: number
  y: number
}

function Legend({ names, dashed }: { names: string[]; dashed?: (index: number) => boolean }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[12px] text-body">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} className="flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden="true">
            {dashed?.(index) ? (
              <line x1="0" y1="5" x2="14" y2="5" stroke={seriesColor(index)} strokeWidth="2.5" strokeDasharray="3 2" />
            ) : (
              <rect x="0" y="1" width="14" height="8" rx="2" fill={seriesColor(index)} />
            )}
          </svg>
          {name}
        </li>
      ))}
    </ul>
  )
}

function Tooltip({ hover, title, rows, boxWidth }: { hover: Hover; title: string; rows: Array<{ name: string; value: string; index: number }>; boxWidth: number }) {
  const flip = hover.x > boxWidth * 0.6
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[140px] rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-[12px] shadow-[0_4px_16px_rgba(24,24,27,0.10)]"
      style={{ top: Math.max(0, hover.y - 12), ...(flip ? { right: boxWidth - hover.x + 12 } : { left: hover.x + 12 }) }}
    >
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((row) => (
        <div key={`${row.name}-${row.index}`} className="flex items-center justify-between gap-4 text-body">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: seriesColor(row.index) }} />
            {row.name}
          </span>
          <span className="font-medium text-ink tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

/** A bar with its data end rounded (radius 4, less for thin bars); the baseline end stays square. */
function barPath(x: number, y: number, width: number, height: number, end: 'top' | 'bottom' | 'right' | 'left' | 'none'): string {
  const radius = end === 'none' ? 0 : Math.max(0, Math.min(4, width / 2, height / 2))
  const right = x + width
  const bottom = y + height
  switch (end) {
    case 'top':
      return `M${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${right - radius}Q${right},${y} ${right},${y + radius}V${bottom}Z`
    case 'bottom':
      return `M${x},${y}V${bottom - radius}Q${x},${bottom} ${x + radius},${bottom}H${right - radius}Q${right},${bottom} ${right},${bottom - radius}V${y}Z`
    case 'right':
      return `M${x},${y}H${right - radius}Q${right},${y} ${right},${y + radius}V${bottom - radius}Q${right},${bottom} ${right - radius},${bottom}H${x}Z`
    case 'left':
      return `M${right},${y}H${x + radius}Q${x},${y} ${x},${y + radius}V${bottom - radius}Q${x},${bottom} ${x + radius},${bottom}H${right}Z`
    default:
      return `M${x},${y}H${right}V${bottom}H${x}Z`
  }
}

interface CartesianModel {
  type: 'bar' | 'line' | 'area'
  horizontal: boolean
  stacked: StackedSeries[] | null
  domain: Domain
  indices: number[]
}

function buildCartesianModel(block: ChartBlock, plotWidth: number): CartesianModel {
  const type = effectiveChartType(block) as CartesianModel['type']
  const values = block.series.map((series) => series.values)
  const stacked = block.stacked ? stackSeries(values) : null
  const [low, high] = valueExtent(block, stacked)
  const horizontal = type === 'bar' && block.horizontal === true
  const domain = niceDomain(low, high, horizontal ? 4 : 5, { min: block.y?.min, max: block.y?.max })
  const indices = type === 'bar' ? values[0].map((_, index) => index) : decimateIndices(values, Math.max(40, Math.floor(plotWidth / 2)))
  return { type, horizontal, stacked, domain, indices }
}

function CartesianChart({ block, width }: { block: ChartBlock; width: number }) {
  const valueFormat: ValueFormat = { format: block.y?.format, currency: block.y?.currency }
  const categories = block.x.values
  const [hover, setHover] = useState<Hover | null>(null)
  const longestTick = useMemo(() => {
    const domain = niceDomain(...valueExtent(block, block.stacked ? stackSeries(block.series.map((series) => series.values)) : null))
    return Math.max(axisLabelChars, ...domain.ticks.map((tick) => formatValue(tick, valueFormat, true).length))
  }, [block, valueFormat.format, valueFormat.currency])
  const horizontalBar = effectiveChartType(block) === 'bar' && block.horizontal === true
  const left = horizontalBar ? horizontalLabelWidth : longestTick * pixelsPerChar + 12
  const bottomSpace = margin.bottom + (block.x.label && !horizontalBar ? 16 : 0)
  const plotWidth = Math.max(80, width - left - margin.right)
  const model = useMemo(() => buildCartesianModel(block, plotWidth), [block, plotWidth])
  const { domain, stacked, indices, type } = model
  const height = horizontalBar ? Math.max(plotHeight, Math.min(categories.length * 28, 2400)) + margin.top + bottomSpace : plotHeight + margin.top + bottomSpace
  const innerHeight = height - margin.top - bottomSpace
  const valueToPixel = (value: number) =>
    horizontalBar ? left + ((value - domain.min) / (domain.max - domain.min)) * plotWidth : margin.top + innerHeight - ((value - domain.min) / (domain.max - domain.min)) * innerHeight
  const baseline = valueToPixel(Math.max(domain.min, Math.min(0, domain.max)))
  const categoryCount = categories.length
  const band = (horizontalBar ? innerHeight : plotWidth) / Math.max(1, categoryCount)
  const categoryCenter = (index: number) =>
    type === 'bar' ? (horizontalBar ? margin.top : left) + band * (index + 0.5) : left + (categoryCount <= 1 ? plotWidth / 2 : (index / (categoryCount - 1)) * plotWidth)
  const step = labelStep(categoryCount, horizontalBar ? innerHeight : plotWidth, horizontalBar ? 18 : Math.min(90, 8 + 6.5 * Math.max(...categories.slice(0, 200).map((c) => categoryLabel(c).length))))

  const indexAt = (event: PointerEvent<SVGRectElement>): Hover | null => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!box) return null
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const along = horizontalBar ? y - margin.top : x - left
    const span = horizontalBar ? innerHeight : plotWidth
    const raw = type === 'bar' ? Math.floor(along / band) : Math.round((along / span) * (categoryCount - 1))
    const index = Math.max(0, Math.min(categoryCount - 1, raw))
    return { index, x, y }
  }

  const bars = () => {
    const groupCount = stacked ? 1 : block.series.length
    const inner = band * (categoryCount > 60 ? 0.9 : 0.72)
    const barWidth = Math.max(1, inner / groupCount - (groupCount > 1 ? 2 : 0))
    const topSegment = stacked
      ? categories.map((_, index) => {
          let top = -1
          let bottom = -1
          stacked.forEach((series, seriesIndex) => {
            const segment = series[index]
            if (!segment || segment[1] === segment[0]) return
            if (segment[1] > 0) top = seriesIndex
            if (segment[1] < 0) bottom = seriesIndex
          })
          return { top, bottom }
        })
      : null
    return block.series.flatMap((series, seriesIndex) =>
      series.values.map((value, index) => {
        if (value === null) return null
        const [from, to] = stacked ? (stacked[seriesIndex][index] as [number, number]) : [0, value]
        const start = valueToPixel(from)
        const end = valueToPixel(to)
        const offset = (band - inner) / 2 + (stacked ? 0 : seriesIndex * (barWidth + 2))
        const isEnd = !topSegment || topSegment[index].top === seriesIndex || topSegment[index].bottom === seriesIndex
        const positive = to >= from
        const along = (horizontalBar ? margin.top : left) + band * index + offset
        const path = horizontalBar
          ? barPath(Math.min(start, end), along, Math.abs(end - start), barWidth, isEnd ? (positive ? 'right' : 'left') : 'none')
          : barPath(along, Math.min(start, end), barWidth, Math.abs(end - start), isEnd ? (positive ? 'top' : 'bottom') : 'none')
        return (
          <path
            key={`${seriesIndex}-${index}`}
            d={path}
            fill={seriesColor(seriesIndex)}
            fillOpacity={isRepeatedSlot(seriesIndex) ? 0.55 : hover && hover.index !== index ? 0.55 : 1}
            stroke={stacked ? 'var(--color-surface)' : undefined}
            strokeWidth={stacked ? 1 : undefined}
          />
        )
      }),
    )
  }

  const lines = () =>
    block.series.map((series, seriesIndex) => {
      const points = indices.map((index) => {
        const value = series.values[index]
        if (value === null) return null
        const top = stacked ? (stacked[seriesIndex][index] as [number, number])[1] : value
        const base = stacked ? (stacked[seriesIndex][index] as [number, number])[0] : Math.max(domain.min, Math.min(0, domain.max))
        return { x: categoryCenter(index), y: valueToPixel(top), base: valueToPixel(base) }
      })
      const runs: Array<typeof points> = [[]]
      points.forEach((point) => (point ? runs[runs.length - 1].push(point) : runs.push([])))
      const color = seriesColor(seriesIndex)
      return (
        <g key={seriesIndex}>
          {runs
            .filter((run) => run.length > 0)
            .map((run, runIndex) => {
              const line = run.map((point, index) => `${index === 0 ? 'M' : 'L'}${point!.x},${point!.y}`).join('')
              const area = type === 'area' ? `${line}${[...run].reverse().map((point) => `L${point!.x},${point!.base}`).join('')}Z` : null
              return (
                <g key={runIndex}>
                  {area && <path d={area} fill={color} fillOpacity={stacked ? 0.55 : 0.16} />}
                  <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={isRepeatedSlot(seriesIndex) ? '5 3' : undefined} />
                </g>
              )
            })}
          {indices.length <= markerLimit &&
            points.map((point, index) => point && <circle key={index} cx={point.x} cy={point.y} r={3.5} fill={color} stroke="var(--color-surface)" strokeWidth={2} />)}
        </g>
      )
    })

  const tooltipRows = hover
    ? block.series.map((series, index) => {
        const value = series.values[hover.index]
        return { name: series.name, index, value: value === null ? messages().visuals.noData : formatValue(value, valueFormat) }
      })
    : []

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={block.title ?? messages().visuals.kindNames.chart} className="block overflow-visible">
        {domain.ticks.map((tick) => {
          const position = valueToPixel(tick)
          return horizontalBar ? (
            <g key={tick}>
              <line x1={position} x2={position} y1={margin.top} y2={margin.top + innerHeight} stroke="var(--color-line)" />
              <text x={position} y={margin.top + innerHeight + 18} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
                {formatValue(tick, valueFormat, true)}
              </text>
            </g>
          ) : (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={position} y2={position} stroke="var(--color-line)" />
              <text x={left - 8} y={position + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {formatValue(tick, valueFormat, true)}
              </text>
            </g>
          )
        })}
        {horizontalBar ? (
          <line x1={baseline} x2={baseline} y1={margin.top} y2={margin.top + innerHeight} stroke="var(--color-line-heavy)" />
        ) : (
          <line x1={left} x2={left + plotWidth} y1={baseline} y2={baseline} stroke="var(--color-line-heavy)" />
        )}
        {categories.map((category, index) => {
          if (index % step !== 0) return null
          const label = categoryLabel(category)
          return horizontalBar ? (
            <text key={index} x={left - 8} y={categoryCenter(index) + 4} textAnchor="end" className="fill-body text-[12px]">
              <title>{label}</title>
              {label.length > 18 ? `${label.slice(0, 17)}…` : label}
            </text>
          ) : (
            <text key={index} x={categoryCenter(index)} y={margin.top + innerHeight + 18} textAnchor="middle" className="fill-body text-[11px]">
              {label}
            </text>
          )
        })}
        {block.x.label && !horizontalBar && (
          <text x={left + plotWidth / 2} y={height - 4} textAnchor="middle" className="fill-muted text-[11px]">
            {block.x.label}
          </text>
        )}
        {hover && type !== 'bar' && (
          <line x1={categoryCenter(hover.index)} x2={categoryCenter(hover.index)} y1={margin.top} y2={margin.top + innerHeight} stroke="var(--color-line-heavy)" strokeDasharray="3 3" />
        )}
        {type === 'bar' ? bars() : lines()}
        <rect
          x={horizontalBar ? 0 : left}
          y={margin.top}
          width={horizontalBar ? left + plotWidth : plotWidth}
          height={innerHeight}
          fill="transparent"
          onPointerMove={(event) => setHover(indexAt(event))}
        />
      </svg>
      {hover && <Tooltip hover={hover} boxWidth={width} title={categoryLabel(categories[hover.index])} rows={tooltipRows} />}
    </div>
  )
}

function RoundChart({ block, width }: { block: ChartBlock; width: number }) {
  const valueFormat: ValueFormat = { format: block.y?.format, currency: block.y?.currency }
  const [hovered, setHovered] = useState<{ index: number; x: number; y: number } | null>(null)
  const folded = useMemo(
    () => foldSlices(block.x.values.map(categoryLabel), block.series[0].values.map((value) => value ?? 0), messages().visuals.other),
    [block],
  )
  const size = Math.min(roundHeight, width)
  const radius = size / 2 - 4
  const slices = useMemo(() => pieSlices(folded.values, radius, block.type === 'donut' ? radius * 0.6 : 0, [size / 2, size / 2]), [folded, radius, size, block.type])
  const total = folded.values.reduce((sum, value) => sum + value, 0)
  const boxRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div ref={boxRef} className="relative" onPointerLeave={() => setHovered(null)}>
        <svg width={size} height={size} role="img" aria-label={block.title ?? messages().visuals.kindNames.chart}>
          {slices.map((slice) => (
            <path
              key={slice.index}
              d={slice.path}
              fill={seriesColor(slice.index)}
              stroke="var(--color-surface)"
              strokeWidth={2}
              fillOpacity={hovered && hovered.index !== slice.index ? 0.55 : 1}
              onPointerMove={(event) => {
                const box = boxRef.current?.getBoundingClientRect()
                if (box) setHovered({ index: slice.index, x: event.clientX - box.left, y: event.clientY - box.top })
              }}
            />
          ))}
          {block.type === 'donut' && (
            <text x={size / 2} y={size / 2 + 6} textAnchor="middle" className="fill-ink text-[16px] font-semibold tabular-nums">
              {formatValue(total, valueFormat, true)}
            </text>
          )}
        </svg>
        {hovered && (
          <Tooltip
            hover={hovered}
            boxWidth={size}
            title={folded.labels[hovered.index]}
            rows={[{ name: `${Math.round((folded.values[hovered.index] / total) * 1000) / 10}%`, value: formatValue(folded.values[hovered.index], valueFormat), index: hovered.index }]}
          />
        )}
      </div>
      <ul className="m-0 flex min-w-[180px] flex-1 list-none flex-col gap-1.5 p-0 text-[13px]">
        {folded.labels.map((label, index) => (
          <li key={`${label}-${index}`} className="flex items-center justify-between gap-4 border-b border-chip pb-1.5 last:border-b-0">
            <span className="flex items-center gap-2 text-body">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesColor(index) }} />
              {label}
            </span>
            <span className="font-medium text-ink tabular-nums">
              {formatValue(folded.values[index], valueFormat)}
              <span className="ml-2 text-[12px] font-normal text-muted">{total > 0 ? `${Math.round((folded.values[index] / total) * 1000) / 10}%` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The data as a table: every category and series, exact values. */
function ChartTable({ block }: { block: ChartBlock }) {
  const valueFormat: ValueFormat = { format: block.y?.format, currency: block.y?.currency }
  return (
    <div className="max-h-[360px] overflow-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-subtle">
          <tr className="text-left text-muted">
            <th scope="col" className="border-b border-line px-3 py-2 font-medium">{block.x.label ?? messages().visuals.category}</th>
            {block.series.map((series, index) => (
              <th key={`${series.name}-${index}`} scope="col" className="border-b border-line px-3 py-2 text-right font-medium">{series.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.x.values.map((category, index) => (
            <tr key={index} className="border-b border-chip last:border-b-0">
              <th scope="row" className="px-3 py-1.5 text-left font-medium">{categoryLabel(category)}</th>
              {block.series.map((series, seriesIndex) => {
                const value = series.values[index]
                return (
                  <td key={seriesIndex} className="px-3 py-1.5 text-right text-body tabular-nums">
                    {value === null ? '–' : formatValue(value, valueFormat)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A `chart` block, chart or table view. */
export function ChartView({ block }: { block: ChartBlock }) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>()
  const [showTable, setShowTable] = useState(false)
  const isRound = block.type === 'pie' || block.type === 'donut'
  const drawnAsArea = effectiveChartType(block) !== block.type
  return (
    <div ref={boxRef} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!isRound && block.series.length > 1 ? <Legend names={block.series.map((series) => series.name)} dashed={isRepeatedSlot} /> : <span />}
        <button type="button" onClick={() => setShowTable((shown) => !shown)} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-brand underline hover:text-brand-strong">
          {showTable ? messages().visuals.showAsChart : messages().visuals.showAsTable}
        </button>
      </div>
      {showTable ? (
        <ChartTable block={block} />
      ) : width > 0 ? (
        isRound ? <RoundChart block={block} width={width} /> : <CartesianChart block={block} width={width} />
      ) : (
        <div style={{ height: isRound ? roundHeight : plotHeight }} />
      )}
      {drawnAsArea && !showTable && <p className="m-0 text-[12px] text-muted">{messages().visuals.drawnAsArea}</p>}
    </div>
  )
}

export default ChartView
