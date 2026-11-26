import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getRunInputs } from '@/api/runReview'
import type { RunInputs } from '@/api/runReviewTypes'
import { listRuns, startRun } from '@/api/runs'
import { getRunSummary } from '@/api/runSummary'
import type { RunSummary } from '@/api/runSummaryTypes'
import type { Run } from '@/api/types'
import { AppShell } from '@/components/layout'
import { useLoadedData } from '@/hooks/useRunData'
import { agentPath, routePaths, runReviewPath, sampleAgentId } from '@/routes'
import { buildTableCsvHref } from '@/pages/agent-run/placesCsv'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { RunItemsTable, RunStatTiles } from '@/pages/agent-run/RunResultDetails'
import { buildRunResultView } from '@/pages/agent-run/runResultSummary'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { buildRunSidebarAgents, useRunAgent } from '@/pages/agent-run/runAgentSidebar'
import { summarizeRunInputs } from '@/pages/agent-run/runInputValues'
import { toError } from '@/lib/errors'
import { messages } from '@/i18n'

/** How many of the agent's newest runs are searched for its latest finished test. */
const latestTestSearchLimit = 50
const finishedStatuses = new Set<Run['status']>(['succeeded', 'failed', 'aborted'])

/**
 * "What next?": run the agent now with the same inputs (then review its questions, screen 19)
 * or put it on a schedule (08). "Run it now" is offered only when the run's inputs are known.
 */
function WhatNextCard({ agentId, runInputs }: { agentId: string; runInputs: RunInputs | null }) {
  const navigate = useNavigate()
  const [startError, setStartError] = useState<Error | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const runNow = async (inputs: RunInputs) => {
    setIsStarting(true)
    setStartError(null)
    try {
      const startedRun = await startRun(agentId, 'manual', inputs)
      navigate(runReviewPath(startedRun.id))
    } catch (startFailure) {
      setStartError(toError(startFailure))
      setIsStarting(false)
    }
  }

  return (
    <div className="flex box-content max-w-[92%] flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="font-semibold">{messages().agentRun.whatNext}</span>
      {startError && <RunErrorNotice title={messages().agentRun.couldNotStartTheRun} error={startError} />}
      <div className="flex flex-col gap-2">
        {runInputs && (
          <button
            type="button"
            disabled={isStarting}
            onClick={() => void runNow(runInputs)}
            className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-3.5 text-left text-[14px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStarting ? messages().agentRun.starting : messages().agentRun.runItNowWithTheSame}
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate(agentPath('scheduleAgent', agentId))}
          className="h-11 cursor-pointer rounded-[9px] border-0 bg-ink px-3.5 text-left text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          {messages().agentRun.putItOnASchedule}
        </button>
      </div>
    </div>
  )
}

function ResultStatusPill({ run, isLoading }: { run: RunSummary | null; isLoading: boolean }) {
  if (isLoading || !run) return <StatusPill tone="neutral" size="title">{messages().agentRun.loading}</StatusPill>
  if (run.status === 'succeeded') return <StatusPill tone="ok" size="title">{messages().agentRun.succeeded}</StatusPill>
  if (run.status === 'failed') return <StatusPill tone="danger" size="title">{messages().agentRun.failed}</StatusPill>
  if (run.status === 'paused') return <StatusPill tone="amber" size="title">{messages().agentRun.waitingForYou2}</StatusPill>
  return <StatusPill tone="neutral" size="title">{run.status === 'aborted' ? messages().agentRun.stopped : messages().agentRun.running}</StatusPill>
}

/** The run named by `?runId=`, else the agent's latest finished test run; null when it has none. */
async function resolveResultRunId(agentId: string, runId: string | null): Promise<string | null> {
  if (runId) return runId
  const agentRuns = await listRuns({ agentId, limit: latestTestSearchLimit })
  return agentRuns.find((run) => run.trigger === 'test' && finishedStatuses.has(run.status))?.id ?? null
}

/** The run's inputs only add the "run it now" offer, so failing to read them must not hide the result. */
async function readRunInputsOrNull(runId: string): Promise<RunInputs | null> {
  try {
    return await getRunInputs(runId)
  } catch (inputsError) {
    console.warn(`Could not read the inputs of run ${runId}`, inputsError)
    return null
  }
}

interface ResultRun {
  summary: RunSummary
  inputs: RunInputs | null
}

/** Loads the result run's summary and inputs; null when there is no run to show. */
function useResultRun(agentId: string, runId: string | null) {
  return useLoadedData<ResultRun | null>(async () => {
    const resolvedRunId = await resolveResultRunId(agentId, runId)
    if (!resolvedRunId) return null
    const [summary, inputs] = await Promise.all([getRunSummary(resolvedRunId), readRunInputsOrNull(resolvedRunId)])
    return { summary, inputs }
  }, [agentId, runId])
}

/** Honest note instead of the table when the run listed nothing (and maybe counted nothing). */
function MissingOutputsNotice({ hasNoCounters }: { hasNoCounters: boolean }) {
  return (
    <p className="m-0 rounded-xl border border-line bg-surface px-4 py-3 text-body">
      {hasNoCounters ? messages().agentRun.thisRunDidNotListThe : messages().agentRun.thisRunDidNotListThe2}
    </p>
  )
}

/** Shown when the agent has no finished test yet. */
function NoTestRunNotice({ agentId }: { agentId: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="font-semibold">{messages().agentRun.noFinishedTestYet}</span>
      <span className="text-[13px] text-body">{messages().agentRun.testThisAgentToSeeWhat}</span>
      <Link to={agentPath('testRun', agentId)} className="self-start font-medium">
        {messages().agentRun.testIt}
      </Link>
    </div>
  )
}

function ResultDetails({ resultRun }: { resultRun: ResultRun }) {
  const view = buildRunResultView(resultRun.summary)
  return (
    <>
      <RunStatTiles stats={view.stats} />
      {view.activity && <p className="m-0 text-[13px] text-body">{view.activity}</p>}
      {view.table ? <RunItemsTable table={view.table} /> : <MissingOutputsNotice hasNoCounters={view.hasNoOutputs} />}
    </>
  )
}

/**
 * Screen 07 · Test run result (`/agents/:agentId/test-result`, optional `?runId=`).
 * Shows one run's summary (`getRunSummary`): its headline, counters as stat tiles, time,
 * step and approval counts, and its `items` as a table with a CSV export. Without `runId` it
 * shows the agent's latest finished test run. Only what the run reported is shown; a run
 * without items or counters says so. Asks what to do next: run now or put it on a schedule.
 */
export function RunResultPage() {
  const { agentId = sampleAgentId } = useParams()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const agent = useRunAgent(agentId)
  const { data: resultRun, error, isLoading } = useResultRun(agentId, runId)
  const view = resultRun ? buildRunResultView(resultRun.summary) : null
  const inputsSummary = summarizeRunInputs(resultRun?.inputs ?? null)
  const meta = isLoading ? messages().agentRun.loadingTheRun : (view?.meta ?? messages().agentRun.noRunToShow)

  return (
    <AppShell agents={buildRunSidebarAgents(agentId, agent)}>
      <RunWorkspace>
        <BuildChatPanel>
          {resultRun && <UserChatBubble>{inputsSummary ? messages().agentRun.testWith(inputsSummary) : messages().agentRun.testThisAgent}</UserChatBubble>}
          {view && <BuilderReply>{view.builderReply}</BuilderReply>}
          {resultRun && <WhatNextCard agentId={agentId} runInputs={resultRun.inputs} />}
        </BuildChatPanel>

        <RunPanel
          headerAction={
            view?.table && (
              <a href={buildTableCsvHref(view.table)} download={`run-${resultRun?.summary.runId.slice(0, 8)}.csv`} className={runHeaderActionClassNames}>
                {messages().agentRun.exportCsv}
              </a>
            )
          }
        >
          <RunTitleRow meta={meta} status={<ResultStatusPill run={resultRun?.summary ?? null} isLoading={isLoading} />} />
          {error && <RunErrorNotice title={messages().agentRun.couldNotLoadThisRun} error={error} />}
          {resultRun && <ResultDetails resultRun={resultRun} />}
          {!isLoading && !error && !resultRun && <NoTestRunNotice agentId={agentId} />}
          <Link to={routePaths.runs} className="self-start font-medium">
            {messages().agentRun.openTheStepByStepLog}
          </Link>
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}
