/**
 * graphrt UI blocks as the backend sends them (`RunVisual.block`, `PendingApproval.card`): objects whose
 * `$ui` names the kind. The backend validated each one with graphrt-ui (`src-tauri/src/ui_blocks.rs`), so
 * these types describe valid blocks; renderers still treat every optional field as possibly absent.
 */

export type NumberFormat = 'number' | 'compact' | 'percent' | 'currency'
export type ColumnFormat = NumberFormat | 'text' | 'date' | 'status'

interface BlockEnvelope {
  version: 1
  title?: string
  subtitle?: string
  fallback_text?: string
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut'

export interface ChartSeries {
  name: string
  /** One per category; null means "no data". */
  values: Array<number | null>
}

export interface ChartBlock extends BlockEnvelope {
  $ui: 'chart'
  type: ChartType
  x: { label?: string; values: Array<string | number> }
  y?: { label?: string; format?: NumberFormat; currency?: string; min?: number; max?: number }
  series: ChartSeries[]
  stacked?: boolean
  horizontal?: boolean
}

export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
  format?: ColumnFormat
  currency?: string
}

export type TableCellValue = string | number | boolean | null

export interface TableBlock extends BlockEnvelope {
  $ui: 'table'
  columns: TableColumn[]
  rows: Array<Record<string, TableCellValue>>
}

export interface StatItem {
  label: string
  value: number | string
  format?: NumberFormat
  currency?: string
  delta?: number
  delta_format?: 'number' | 'percent'
  trend?: 'up' | 'down' | 'flat'
  good?: 'up' | 'down'
  caption?: string
}

export interface StatsBlock extends BlockEnvelope {
  $ui: 'stats'
  items: StatItem[]
}

/** An Adaptive Card element or action: checked by graphrt-ui, read field by field by the renderer. */
export type CardNode = { type: string } & Record<string, unknown>

export interface AdaptiveCard {
  type: 'AdaptiveCard'
  version?: string
  body?: CardNode[]
  actions?: CardNode[]
  [key: string]: unknown
}

export interface AdaptiveCardBlock extends BlockEnvelope {
  $ui: 'adaptive_card'
  card: AdaptiveCard
}

export type UiBlock = ChartBlock | TableBlock | StatsBlock | AdaptiveCardBlock
export type UiBlockKind = UiBlock['$ui']
