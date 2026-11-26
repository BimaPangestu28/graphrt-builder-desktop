import { VisuallyHidden } from '@/components/ui'
import type { StatsBlock } from '../uiBlockTypes'
import { buildStatTile, type DeltaTone } from './statsModel'

const toneClassNames: Record<DeltaTone, string> = {
  good: 'bg-ok-tint text-ok-strong',
  bad: 'bg-danger-tint text-danger',
  neutral: 'bg-chip text-muted',
}

const arrows = { up: '↑', down: '↓', flat: '→' } as const

/** A `stats` block: KPI tiles in a grid that wraps on narrow panels instead of squeezing the numbers. */
export function StatsView({ block }: { block: StatsBlock }) {
  return (
    <dl className="m-0 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(176px, 1fr))' }}>
      {block.items.map((item, index) => {
        const tile = buildStatTile(item)
        return (
          <div key={`${item.label}-${index}`} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3.5">
            <dt className="text-[12px] text-muted">{tile.label}</dt>
            <dd className="m-0 text-[22px] leading-tight font-semibold tabular-nums break-words">{tile.value}</dd>
            {(tile.delta || tile.caption) && (
              <dd className="m-0 flex flex-wrap items-center gap-1.5 text-[12px]">
                {tile.delta && (
                  <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums ${toneClassNames[tile.delta.tone]}`}>
                    <span aria-hidden="true">{arrows[tile.delta.trend]}</span>
                    <span aria-hidden="true">{tile.delta.text}</span>
                    <VisuallyHidden>{tile.delta.spoken}</VisuallyHidden>
                  </span>
                )}
                {tile.caption && <span className="text-muted">{tile.caption}</span>}
              </dd>
            )}
          </div>
        )
      })}
    </dl>
  )
}

export default StatsView
