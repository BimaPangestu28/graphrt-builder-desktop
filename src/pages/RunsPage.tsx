import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Run } from '@/api/types'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { defaultSelectedRunId } from '@/data/runs'
import { useAgentNames, type AgentNameLookup } from '@/hooks/useAgentNames'
import { getVersionFlowSummary } from '@/api/versions'
import { useNow } from '@/hooks/useNow'
import { useLoadedData } from '@/hooks/useRunData'
import { useRunEvents, useRuns } from '@/hooks/useRuns'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { toRunStepTemplate } from '@/pages/agent-run/runProgress'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { RunDetailPanel } from './runs/RunDetailPanel'
import { RunsTable } from './runs/RunsTable'
import { allAgentsFilterValue, countRunsForFilter, toRunFilter, toRunRecord, withRunEvents, type RunsStatusFilter } from './runs/runViewModel'

const statusFilterOptions: Array<{ key: RunsStatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needsYou', label: 'Needs you' },
  { key: 'running', label: 'Running' },
  { key: 'failed', label: 'Failed' },
]

/** Agent ids in the order they first appear in the run list. */
function listAgentIds(runs: Run[]): string[] {
  return Array.from(new Set(runs.map((run) => run.agentId)))
}

interface RunsFilterBarProps {
  agentFilter: string
  statusFilter: RunsStatusFilter
  allRuns: Run[]
  getAgentName: AgentNameLookup
  onAgentFilterChange: (agentId: string) => void
  onStatusFilterChange: (status: RunsStatusFilter) => void
}

function RunsFilterBar({ agentFilter, statusFilter, allRuns, getAgentName, onAgentFilterChange, onStatusFilterChange }: RunsFilterBarProps) {
  const agentRuns = agentFilter === allAgentsFilterValue ? allRuns : allRuns.filter((run) => run.agentId === agentFilter)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Agent"
        value={agentFilter}
        onChange={(event) => onAgentFilterChange(event.target.value)}
        className="h-[34px] rounded-full border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink"
      >
        <option value={allAgentsFilterValue}>All agents</option>
        {listAgentIds(allRuns).map((agentId) => (
          <option key={agentId} value={agentId}>
            {getAgentName(agentId)}
          </option>
        ))}
      </select>
      {statusFilterOptions.map((option) => {
        const isActive = option.key === statusFilter
        const runCount = countRunsForFilter(agentRuns, option.key)
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

/** Detail panel for the selected run, with steps and raw log from its events. */
function SelectedRunPanel({ run, getAgentName, onClose }: { run: Run; getAgentName: AgentNameLookup; onClose: () => void }) {
  const { data: events } = useRunEvents(run.id)
  const { data: flowSummary } = useLoadedData(() => getVersionFlowSummary(run.agentId, run.agentVersion), [run.agentId, run.agentVersion])
  const now = useNow(run.status === 'running')
  const record = withRunEvents(toRunRecord(run, getAgentName(run.agentId)), events ?? [])
  const stepViews = buildRunStepViews(toRunStepTemplate(flowSummary), events ?? [])
  return <RunDetailPanel key={run.id} run={record} stepViews={stepViews} now={now} onClose={onClose} />
}

/**
 * Screen 20 · Runs.
 * Everything the agents did, newest first, from `listRuns`: filter by agent and status (sent to the
 * backend as a `RunFilter`), pick a run to see its steps, output and raw log from `listRunEvents`.
 * The list refreshes when runs start or change status.
 */
export function RunsPage() {
  const [agentFilter, setAgentFilter] = useState(allAgentsFilterValue)
  const [statusFilter, setStatusFilter] = useState<RunsStatusFilter>('all')
  // `?runId=` (from Home's recent runs and other links) selects that run; otherwise the default.
  const [searchParams] = useSearchParams()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get('runId') ?? defaultSelectedRunId)
  const getAgentName = useAgentNames()
  const allRunsData = useRuns()
  const visibleRunsData = useRuns(toRunFilter(agentFilter, statusFilter))

  const allRuns = allRunsData.data ?? []
  const visibleRecords = (visibleRunsData.data ?? []).map((run) => toRunRecord(run, getAgentName(run.agentId)))
  const selectedRun = allRuns.find((run) => run.id === selectedRunId)
  const loadError = allRunsData.error ?? visibleRunsData.error
  const isFirstLoad = visibleRunsData.isLoading && visibleRunsData.data === null

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
          allRuns={allRuns}
          getAgentName={getAgentName}
          onAgentFilterChange={setAgentFilter}
          onStatusFilterChange={setStatusFilter}
        />
        {loadError && <RunErrorNotice title="Could not load runs" error={loadError} />}
        <RunsTable
          runs={visibleRecords}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          emptyMessage={isFirstLoad ? 'Loading runs…' : 'No runs match these filters'}
        />
      </section>
      {selectedRun && <SelectedRunPanel key={selectedRun.id} run={selectedRun} getAgentName={getAgentName} onClose={() => setSelectedRunId(null)} />}
    </AppShell>
  )
}
