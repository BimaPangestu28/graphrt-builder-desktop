import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { defaultSelectedRunId, runRecords, type RunRecord, type RunStatus } from '@/data/runs'
import { RunDetailPanel } from './runs/RunDetailPanel'
import { RunsTable } from './runs/RunsTable'

type StatusFilter = 'all' | Exclude<RunStatus, 'done'>

const statusFilterOptions: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needsYou', label: 'Needs you' },
  { key: 'running', label: 'Running' },
  { key: 'failed', label: 'Failed' },
]

const allAgentsValue = 'all'
const agentNames = Array.from(new Set(runRecords.map((run) => run.agentName)))

function countRunsWithStatus(runs: RunRecord[], status: StatusFilter): number | null {
  if (status === 'all') return null
  return runs.filter((run) => run.status === status).length
}

interface RunsFilterBarProps {
  agentFilter: string
  statusFilter: StatusFilter
  agentRuns: RunRecord[]
  onAgentFilterChange: (agentName: string) => void
  onStatusFilterChange: (status: StatusFilter) => void
}

function RunsFilterBar({ agentFilter, statusFilter, agentRuns, onAgentFilterChange, onStatusFilterChange }: RunsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Agent"
        value={agentFilter}
        onChange={(event) => onAgentFilterChange(event.target.value)}
        className="h-[34px] rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink"
      >
        <option value={allAgentsValue}>All agents</option>
        {agentNames.map((agentName) => (
          <option key={agentName} value={agentName}>
            {agentName}
          </option>
        ))}
      </select>
      {statusFilterOptions.map((option) => {
        const isActive = option.key === statusFilter
        const runCount = countRunsWithStatus(agentRuns, option.key)
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onStatusFilterChange(option.key)}
            className={joinClassNames(
              'h-[34px] cursor-pointer rounded-full px-3 text-[13px] font-medium',
              isActive ? 'border-0 bg-ink text-white' : 'border border-line-strong bg-surface text-ink hover:bg-subtle',
            )}
          >
            {option.label}
            {runCount !== null && ` ${runCount}`}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Screen 20 · Runs.
 * Everything the agents did, newest first: filter by agent and status, pick a run
 * to see its steps, output and raw log in the side panel.
 */
export function RunsPage() {
  const [agentFilter, setAgentFilter] = useState(allAgentsValue)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(defaultSelectedRunId)

  const agentRuns = agentFilter === allAgentsValue ? runRecords : runRecords.filter((run) => run.agentName === agentFilter)
  const visibleRuns = statusFilter === 'all' ? agentRuns : agentRuns.filter((run) => run.status === statusFilter)
  const selectedRun = runRecords.find((run) => run.id === selectedRunId)

  return (
    <AppShell activeNav="runs" mainClassName="flex flex-wrap">
      <section aria-label="All runs" className="box-border flex min-w-0 flex-[3_1_560px] flex-col gap-[18px] p-7">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.5px]">Runs</h1>
          <span className="text-body">Everything your agents did, newest first. Kept for 30 days</span>
        </div>
        <RunsFilterBar
          agentFilter={agentFilter}
          statusFilter={statusFilter}
          agentRuns={agentRuns}
          onAgentFilterChange={setAgentFilter}
          onStatusFilterChange={setStatusFilter}
        />
        <RunsTable runs={visibleRuns} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
      </section>
      {selectedRun && <RunDetailPanel key={selectedRun.id} run={selectedRun} onClose={() => setSelectedRunId(null)} />}
    </AppShell>
  )
}
