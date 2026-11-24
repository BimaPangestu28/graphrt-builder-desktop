import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Run } from '@/api/types'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { getPreviewContent } from '@/api/previewContent'
import { listOnlineRuns } from '@/api/deploy'
import { useAsyncData } from '@/hooks/useAsyncData'
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
import { mergeRunsByPlace, placeFilterOptions, toOnlineRunRecord, toPlaceFilter, type RunsPlaceFilter } from './runs/onlineRuns'
import type { RunRecord } from './runs/runRecordTypes'
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

/** All · On this computer · Online. */
function PlaceFilterBar({ placeFilter, onChange }: { placeFilter: RunsPlaceFilter; onChange: (filter: RunsPlaceFilter) => void }) {
  return (
    <div role="group" aria-label="Where it ran" className="flex flex-wrap gap-1 rounded-[10px] bg-selected p-1 self-start">
      {placeFilterOptions.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === placeFilter}
          onClick={() => onChange(option.key)}
          className={joinClassNames(
            'h-8 cursor-pointer rounded-[7px] border-0 px-3.5 text-[13px]',
            option.key === placeFilter ? 'bg-surface font-semibold text-ink' : 'bg-transparent font-medium text-body hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A run of an online agent: what the server told us (no local events). */
function OnlineRunPanel({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  return <RunDetailPanel key={record.id} run={record} stepViews={[]} onClose={onClose} />
}

/** Detail panel for the selected run, with steps and raw log from its events. */
function SelectedRunPanel({ run, getAgentName, onClose }: { run: Run; getAgentName: AgentNameLookup; onClose: () => void }) {
  const { data: events } = useRunEvents(run.id)
  const { data: flowSummary } = useLoadedData(() => getVersionFlowSummary(run.agentId, run.agentVersion), [run.agentId, run.agentVersion])
  // The clock ticks every second while the run is running; only the panel's times should follow it.
  const now = useNow(run.status === 'running')
  const record = useMemo(() => withRunEvents(toRunRecord(run, getAgentName(run.agentId)), events ?? []), [run, getAgentName, events])
  const stepViews = useMemo(() => buildRunStepViews(toRunStepTemplate(flowSummary), events ?? []), [flowSummary, events])
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
  const [placeFilter, setPlaceFilter] = useState<RunsPlaceFilter>(toPlaceFilter(searchParams.get('where')))
  // Online runs are read from each online agent / server while Runs is open.
  const onlineRunsState = useAsyncData(() => listOnlineRuns(), [])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get('runId') ?? getPreviewContent()?.selectedRunId ?? null)
  const getAgentName = useAgentNames()
  const allRunsData = useRuns()
  const visibleRunsData = useRuns(toRunFilter(agentFilter, statusFilter))

  const allRuns = allRunsData.data ?? []
  const localRecords = (visibleRunsData.data ?? []).map((run) => toRunRecord(run, getAgentName(run.agentId)))
  const onlineRecords = (onlineRunsState.data?.runs ?? [])
    .map((onlineRun) => toOnlineRunRecord(onlineRun))
    .filter((record) => agentFilter === allAgentsFilterValue || record.agentId === agentFilter)
    .filter((record) => statusFilter === 'all' || (statusFilter === 'needsYou' ? record.status === 'needsYou' : record.status === statusFilter))
  const visibleRecords = mergeRunsByPlace(localRecords, onlineRecords, placeFilter)
  const selectedRun = allRuns.find((run) => run.id === selectedRunId)
  const selectedOnlineRecord = onlineRecords.find((record) => record.id === selectedRunId)
  const loadError = allRunsData.error ?? visibleRunsData.error
  const isFirstLoad = visibleRunsData.isLoading && visibleRunsData.data === null

  return (
    <AppShell activeNav="runs" mainClassName="flex flex-wrap">
      <PageFrame ariaLabel="All runs" className="flex-[3_1_560px]">
        <PageTitleBlock title="Runs" subtitle="Everything your agents did, on this computer and online, newest first" />
        <PlaceFilterBar placeFilter={placeFilter} onChange={setPlaceFilter} />
        <RunsFilterBar
          agentFilter={agentFilter}
          statusFilter={statusFilter}
          allRuns={allRuns}
          getAgentName={getAgentName}
          onAgentFilterChange={setAgentFilter}
          onStatusFilterChange={setStatusFilter}
        />
        {loadError && <RunErrorNotice title="Could not load runs" error={loadError} />}
        {placeFilter !== 'local' && (onlineRunsState.data?.problems.length ?? 0) > 0 && (
          <p role="status" className="m-0 text-[13px] text-amber-strong">Some online runs could not be read: {onlineRunsState.data?.problems.join(' · ')}</p>
        )}
        <RunsTable
          runs={visibleRecords}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          emptyMessage={isFirstLoad ? 'Loading runs…' : placeFilter === 'online' ? 'No online runs yet. Put an agent online from its page' : 'No runs match these filters'}
        />
      </PageFrame>
      {selectedOnlineRecord && <OnlineRunPanel record={selectedOnlineRecord} onClose={() => setSelectedRunId(null)} />}
      {selectedRun && <SelectedRunPanel key={selectedRun.id} run={selectedRun} getAgentName={getAgentName} onClose={() => setSelectedRunId(null)} />}
    </AppShell>
  )
}
