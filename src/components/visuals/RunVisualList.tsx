import type { RejectedVisual, RunVisual } from '@/api/runSummaryTypes'
import { messages } from '@/i18n'
import { VisualBlock } from './VisualBlock'

/** A block graphrt-ui refused: which step, and why, so a builder can fix it. */
function RejectedNotice({ rejected }: { rejected: RejectedVisual }) {
  const kindNames = messages().visuals.kindNames as Record<string, string>
  const kind = (rejected.kind && kindNames[rejected.kind]) ?? messages().visuals.kindNames.adaptive_card
  return (
    <div role="note" className="flex flex-col gap-1 rounded-xl border border-amber-line-2 bg-amber-tint px-4 py-3 text-[13px]">
      <span className="font-medium text-amber-strong">
        {rejected.nodeId ? messages().visuals.couldNotShowStep(kind, rejected.nodeId) : messages().visuals.couldNotShow(kind)}
      </span>
      <span className="text-body">
        {messages().visuals.fixHint} <span className="font-mono text-[12px]">{rejected.reason}</span>
      </span>
    </div>
  )
}

/** The cards, charts, tables and KPI tiles of a run, in order, then notices for blocks that failed. */
export function RunVisualList({ visuals, rejected }: { visuals: RunVisual[]; rejected: RejectedVisual[] }) {
  if (visuals.length === 0 && rejected.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {visuals.map((visual) => (
        <VisualBlock key={visual.id} block={visual.block} />
      ))}
      {rejected.map((item, index) => (
        <RejectedNotice key={`${item.nodeId}-${index}`} rejected={item} />
      ))}
    </div>
  )
}
