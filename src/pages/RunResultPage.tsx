import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getRunSummary } from '@/api/runSummary'
import type { RunSummary } from '@/api/runSummaryTypes'
import { AppShell } from '@/components/layout'
import { useLoadedData } from '@/hooks/useRunData'
import { agentPath, routePaths, sampleAgentId } from '@/routes'
import { buildTableCsvHref } from '@/pages/agent-run/placesCsv'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { RunItemsTable, RunStatTiles } from '@/pages/agent-run/RunResultDetails'
import { buildRunResultView } from '@/pages/agent-run/runResultSummary'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'

/** "What next?" card offering a full run (goes to batch review) or a schedule (08). */
function WhatNextCard({ agentId, remainingPlaceCount }: { agentId: string; remainingPlaceCount: number | null }) {
  const navigate = useNavigate()
  return (
    <div className="flex box-content max-w-[92%] flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="font-semibold">What next?</span>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate(routePaths.batchApproval)}
          className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-3.5 text-left text-[14px] font-medium text-ink hover:bg-subtle"
        >
          {remainingPlaceCount ? `Run now for the other ${remainingPlaceCount} places` : 'Run it now for everything'}
        </button>
        <button
          type="button"
          onClick={() => navigate(agentPath('scheduleAgent', agentId))}
          className="h-11 cursor-pointer rounded-[9px] border-0 bg-ink px-3.5 text-left text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          Run it every weekday on new places
        </button>
      </div>
    </div>
  )
}

function ResultStatusPill({ run, isLoading }: { run: RunSummary | null; isLoading: boolean }) {
  if (isLoading) return <StatusPill tone="neutral" size="title">Loading</StatusPill>
  if (!run || run.status === 'succeeded') return <StatusPill tone="ok" size="title">Succeeded</StatusPill>
  if (run.status === 'failed') return <StatusPill tone="danger" size="title">Failed</StatusPill>
  if (run.status === 'paused') return <StatusPill tone="amber" size="title">Waiting for you</StatusPill>
  return <StatusPill tone="neutral" size="title">{run.status === 'aborted' ? 'Stopped' : 'Running'}</StatusPill>
}

/** Loads the summary of the run named by `?runId=`; without one there is nothing to load and the mockup shows. */
function useResultRunSummary(runId: string | null) {
  return useLoadedData<RunSummary | null>(() => (runId ? getRunSummary(runId) : Promise.resolve(null)), [runId])
}

/** "Nothing was listed" note shown instead of the table for runs without `items`. */
function NoItemsNotice() {
  return <p className="m-0 rounded-xl border border-line bg-surface px-4 py-3 text-body">This run did not list the things it handled.</p>
}

/**
 * Screen 07 · Test run result (`/agents/:agentId/test-result?runId=`).
 * Shows the run's summary (`getRunSummary`): its headline, counters as stat tiles, time,
 * step and approval counts, and its `items` as a table with a CSV export. Without a run the
 * mockup's content shows. Asks what to do next: run the rest now or put it on a schedule.
 */
export function RunResultPage() {
  const { agentId = sampleAgentId } = useParams()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const { data: runSummary, error, isLoading } = useResultRunSummary(runId)
  const view = buildRunResultView(runSummary)
  const isRunLoading = isLoading && runId !== null
  const remainingPlaceCount = view.placesFound === null ? null : Math.max(0, view.placesFound - 1)

  return (
    <AppShell agents={{ kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Tested · not scheduled' }} runnerStatus="Online · OpenAI connected">
      <RunWorkspace>
        <BuildChatPanel>
          <UserChatBubble>Test with 1 place</UserChatBubble>
          <BuilderReply>{view.builderReply}</BuilderReply>
          <WhatNextCard agentId={agentId} remainingPlaceCount={remainingPlaceCount} />
        </BuildChatPanel>

        <RunPanel
          headerAction={
            view.table && (
              <a href={buildTableCsvHref(view.table)} download="maps-leads-test-run.csv" className={runHeaderActionClassNames}>
                Export CSV
              </a>
            )
          }
        >
          <RunTitleRow meta={isRunLoading ? 'Loading the run…' : view.meta} status={<ResultStatusPill run={runSummary} isLoading={isRunLoading} />} />
          {error && <RunErrorNotice title="Could not load this run" error={error} />}
          <RunStatTiles stats={view.stats} />
          {view.activity && <p className="m-0 text-[13px] text-body">{view.activity}</p>}
          {view.table ? <RunItemsTable table={view.table} /> : !isRunLoading && !error && <NoItemsNotice />}
          <Link to={routePaths.runs} className="self-start font-medium">
            Open the step by step log
          </Link>
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}
