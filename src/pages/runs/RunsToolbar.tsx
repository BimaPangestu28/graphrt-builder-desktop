import type { ReactNode } from 'react'
import type { Run } from '@/api/types'
import { Icon, joinClassNames } from '@/components/ui'
import type { AgentNameLookup } from '@/hooks/useAgentNames'
import { useT } from '@/i18n'
import { placeFilterOptions, type RunsPlaceFilter } from './onlineRuns'
import { allAgentsFilterValue, countRunsForFilter, type RunsStatusFilter } from './runViewModel'

const statusFilterKeys: readonly RunsStatusFilter[] = ['all', 'needsYou', 'running', 'failed']

/** Count badge colour when the count is above zero; zero stays a quiet grey. */
const countBadgeClassNames: Record<Exclude<RunsStatusFilter, 'all'>, string> = {
  needsYou: 'bg-amber-soft text-amber-strong',
  running: 'bg-brand-soft text-brand-strong',
  failed: 'bg-danger-soft text-danger',
}

/** Same segmented control as the Schedule screen's Day / Week / List switch. */
const segmentedGroupClassNames = 'flex flex-wrap gap-1 rounded-[10px] bg-selected p-1'

function segmentClassNames(isActive: boolean): string {
  return joinClassNames(
    'inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 px-3 text-[13px] transition-colors',
    isActive ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'bg-transparent font-medium text-body hover:text-ink',
  )
}

/** Agent ids in the order they first appear in the run list. */
function listAgentIds(runs: Run[]): string[] {
  return Array.from(new Set(runs.map((run) => run.agentId)))
}

function StatusCountBadge({ statusFilter, count }: { statusFilter: Exclude<RunsStatusFilter, 'all'>; count: number }) {
  return (
    <span
      className={joinClassNames(
        'inline-flex min-w-5 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums',
        count > 0 ? countBadgeClassNames[statusFilter] : 'bg-chip text-muted',
      )}
    >
      {statusFilter === 'running' && count > 0 && <span aria-hidden="true" className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse" />}
      {count}
    </span>
  )
}

function SegmentedGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={segmentedGroupClassNames}>
      {children}
    </div>
  )
}

interface RunsToolbarProps {
  agentFilter: string
  statusFilter: RunsStatusFilter
  placeFilter: RunsPlaceFilter
  /** Every local run, unfiltered: the agent list and the status counts come from it. */
  allRuns: Run[]
  getAgentName: AgentNameLookup
  onAgentFilterChange: (agentId: string) => void
  onStatusFilterChange: (status: RunsStatusFilter) => void
  onPlaceFilterChange: (place: RunsPlaceFilter) => void
}

/**
 * One toolbar for every Runs filter: status (with a coloured count per status: amber for
 * Needs you, teal and pulsing for Running, red for Failed) on the left, then the agent and
 * where it ran. Wraps onto two lines on narrow windows.
 */
export function RunsToolbar({
  agentFilter,
  statusFilter,
  placeFilter,
  allRuns,
  getAgentName,
  onAgentFilterChange,
  onStatusFilterChange,
  onPlaceFilterChange,
}: RunsToolbarProps) {
  const t = useT().runs
  const agentRuns = agentFilter === allAgentsFilterValue ? allRuns : allRuns.filter((run) => run.agentId === agentFilter)
  return (
    <div role="toolbar" aria-label={t.filterRuns} className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedGroup label={t.statusFilter}>
        {statusFilterKeys.map((key) => {
          const isActive = key === statusFilter
          const runCount = countRunsForFilter(agentRuns, key)
          return (
            <button key={key} type="button" aria-pressed={isActive} onClick={() => onStatusFilterChange(key)} className={segmentClassNames(isActive)}>
              <span>{t.statusFilters[key]}</span>
              {key !== 'all' && runCount !== null && (
                <>
                  {' '}
                  <StatusCountBadge statusFilter={key} count={runCount} />
                </>
              )}
            </button>
          )
        })}
      </SegmentedGroup>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <select
            aria-label={t.agent}
            value={agentFilter}
            onChange={(event) => onAgentFilterChange(event.target.value)}
            className="h-10 min-w-[170px] max-w-[260px] cursor-pointer appearance-none truncate rounded-[10px] border border-line-strong bg-surface pl-3.5 pr-9 text-[13px] font-medium text-ink hover:bg-subtle"
          >
            <option value={allAgentsFilterValue}>{t.allAgents}</option>
            {listAgentIds(allRuns).map((agentId) => (
              <option key={agentId} value={agentId}>
                {getAgentName(agentId)}
              </option>
            ))}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute right-3 text-muted">
            <Icon name="chevronDown" size={14} />
          </span>
        </div>
        <SegmentedGroup label={t.whereItRan}>
          {placeFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={option.key === placeFilter}
              onClick={() => onPlaceFilterChange(option.key)}
              className={segmentClassNames(option.key === placeFilter)}
            >
              {option.label}
            </button>
          ))}
        </SegmentedGroup>
      </div>
    </div>
  )
}
