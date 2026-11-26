import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Run } from '@/api/types'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { getPreviewContent } from '@/api/previewContent'
import { listOnlineRuns } from '@/api/deploy'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAgentNames, type AgentNameLookup } from '@/hooks/useAgentNames'
import { useAgents } from '@/hooks/useAgents'
import { getVersionFlowSummary } from '@/api/versions'
import { useNow } from '@/hooks/useNow'
import { useLoadedData } from '@/hooks/useRunData'
import { useRunEvents, useRuns } from '@/hooks/useRuns'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { toRunStepTemplate } from '@/pages/agent-run/runProgress'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { RunDetailPanel } from './runs/RunDetailPanel'
import { RunsTable } from './runs/RunsTable'
import { RunsToolbar } from './runs/RunsToolbar'
import { RunsEmptyStateView, RunsSummary } from './runs/RunsOverviewParts'
import { mergeRunsByPlace, toOnlineRunRecord, toPlaceFilter, type RunsPlaceFilter } from './runs/onlineRuns'
import type { RunRecord } from './runs/runRecordTypes'
import { chooseRunsEmptyState, summarizeRunsToday } from './runs/runsOverview'
import { allAgentsFilterValue, toRunFilter, toRunRecord, toScreenStatus, withRunEvents, type RunsStatusFilter } from './runs/runViewModel'
import { useT } from '@/i18n'

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
  const t = useT().runs
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

  const { data: agents } = useAgents()

  const allRuns = allRunsData.data ?? []
  const allOnlineRecords = (onlineRunsState.data?.runs ?? []).map((onlineRun) => toOnlineRunRecord(onlineRun))
  const localRecords = (visibleRunsData.data ?? []).map((run) => toRunRecord(run, getAgentName(run.agentId)))
  const onlineRecords = allOnlineRecords
    .filter((record) => agentFilter === allAgentsFilterValue || record.agentId === agentFilter)
    .filter((record) => statusFilter === 'all' || record.status === statusFilter)
  const visibleRecords = mergeRunsByPlace(localRecords, onlineRecords, placeFilter)
  const selectedRun = allRuns.find((run) => run.id === selectedRunId)
  const selectedOnlineRecord = onlineRecords.find((record) => record.id === selectedRunId)
  const loadError = allRunsData.error ?? visibleRunsData.error
  const isFirstLoad = visibleRunsData.isLoading && visibleRunsData.data === null
  const hasAgentOrStatusFilter = agentFilter !== allAgentsFilterValue || statusFilter !== 'all'
  const emptyState = chooseRunsEmptyState({
    visibleRunCount: isFirstLoad ? 0 : visibleRecords.length,
    localRunCount: isFirstLoad ? null : (allRunsData.data?.length ?? null),
    // An online list that failed to load counts as none; its problem is shown above the table.
    onlineRunCount: onlineRunsState.data ? onlineRunsState.data.runs.length : onlineRunsState.error ? 0 : null,
    agentCount: agents ? agents.length : null,
    placeFilter,
    hasAgentOrStatusFilter,
  })
  const hasAnyRun = allRuns.length > 0 || allOnlineRecords.length > 0
  const isNothingToFilter = emptyState === 'noAgents' || emptyState === 'noRunsYet'
  const todaySummary = summarizeRunsToday([
    ...allRuns.map((run) => ({ status: toScreenStatus(run.status), startedAt: run.startedAt })),
    ...allOnlineRecords,
  ])

  function clearFilters() {
    setAgentFilter(allAgentsFilterValue)
    setStatusFilter('all')
    setPlaceFilter('all')
  }

  return (
    <AppShell activeNav="runs" mainClassName="flex flex-wrap">
      <PageFrame ariaLabel={t.allRuns} className="flex-[3_1_560px]">
        <PageTitleBlock title={t.title} subtitle={t.subtitle} />
        {hasAnyRun && <RunsSummary summary={todaySummary} />}
        {!isNothingToFilter && (
          <RunsToolbar
            agentFilter={agentFilter}
            statusFilter={statusFilter}
            placeFilter={placeFilter}
            allRuns={allRuns}
            getAgentName={getAgentName}
            onAgentFilterChange={setAgentFilter}
            onStatusFilterChange={setStatusFilter}
            onPlaceFilterChange={setPlaceFilter}
          />
        )}
        {loadError && <RunErrorNotice title={t.couldNotLoad} error={loadError} />}
        {placeFilter !== 'local' && (onlineRunsState.data?.problems.length ?? 0) > 0 && (
          <p role="status" className="m-0 text-[13px] text-amber-strong">{t.onlineProblems(onlineRunsState.data?.problems.join(' · ') ?? '')}</p>
        )}
        {emptyState ? (
          <RunsEmptyStateView state={emptyState} onClearFilters={clearFilters} />
        ) : (
          <RunsTable runs={visibleRecords} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
        )}
      </PageFrame>
      {selectedOnlineRecord && <OnlineRunPanel record={selectedOnlineRecord} onClose={() => setSelectedRunId(null)} />}
      {selectedRun && <SelectedRunPanel key={selectedRun.id} run={selectedRun} getAgentName={getAgentName} onClose={() => setSelectedRunId(null)} />}
    </AppShell>
  )
}
