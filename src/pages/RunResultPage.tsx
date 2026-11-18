import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getRun } from '@/api/runs'
import type { Run } from '@/api/types'
import { AppShell } from '@/components/layout'
import { useLoadedData } from '@/hooks/useRunData'
import { agentPath, routePaths, sampleAgentId } from '@/routes'
import { buildPlacesCsvHref } from '@/pages/agent-run/placesCsv'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { RunPlacesTable, RunStatTiles } from '@/pages/agent-run/RunResultDetails'
import { buildRunResultSummary } from '@/pages/agent-run/runResultSummary'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'

/** "What next?" card offering a full run (goes to batch review) or a schedule (08). */
function WhatNextCard({ agentId, remainingPlaceCount }: { agentId: string; remainingPlaceCount: number }) {
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
          Run now for the other {remainingPlaceCount} places
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

function ResultStatusPill({ run, isLoading }: { run: Run | null; isLoading: boolean }) {
  if (isLoading) return <StatusPill tone="neutral" size="title">Loading</StatusPill>
  if (!run || run.status === 'succeeded') return <StatusPill tone="ok" size="title">Succeeded</StatusPill>
  if (run.status === 'failed') return <StatusPill tone="danger" size="title">Failed</StatusPill>
  if (run.status === 'paused') return <StatusPill tone="amber" size="title">Waiting for you</StatusPill>
  return <StatusPill tone="neutral" size="title">{run.status === 'aborted' ? 'Stopped' : 'Running'}</StatusPill>
}

/** Loads the run named by `?runId=`; without one there is nothing to load and the mockup shows. */
function useResultRun(runId: string | null) {
  return useLoadedData<Run | null>(() => (runId ? getRun(runId) : Promise.resolve(null)), [runId])
}

/**
 * Screen 07 · Test run result (`/agents/:agentId/test-result?runId=`).
 * Shows the finished run's stats and places from its outputs (falling back to the mockup's
 * content for parts the backend does not provide), offers a CSV export, and asks what to do
 * next: run the rest now or put it on a schedule.
 */
export function RunResultPage() {
  const { agentId = sampleAgentId } = useParams()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const { data: run, error, isLoading } = useResultRun(runId)
  const summary = buildRunResultSummary(run)
  const isRunLoading = isLoading && runId !== null

  return (
    <AppShell agents={{ kind: 'draft', name: 'Maps leads to WhatsApp', status: 'Tested · not scheduled' }} runnerStatus="Online · OpenAI connected">
      <RunWorkspace>
        <BuildChatPanel>
          <UserChatBubble>Test with 1 place</UserChatBubble>
          <BuilderReply>{summary.builderReply}</BuilderReply>
          <WhatNextCard agentId={agentId} remainingPlaceCount={Math.max(0, summary.placesFound - 1)} />
        </BuildChatPanel>

        <RunPanel
          headerAction={
            <a href={buildPlacesCsvHref(summary.places)} download="maps-leads-test-run.csv" className={runHeaderActionClassNames}>
              Export CSV
            </a>
          }
        >
          <RunTitleRow meta={isRunLoading ? 'Loading the run…' : summary.meta} status={<ResultStatusPill run={run} isLoading={isRunLoading} />} />
          {error && <RunErrorNotice title="Could not load this run" error={error} />}
          <RunStatTiles stats={summary.stats} />
          <RunPlacesTable places={summary.places} hiddenPlaceCount={summary.hiddenPlaceCount} />
          <Link to={routePaths.runs} className="self-start font-medium">
            Open the step by step log
          </Link>
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}
