import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { readPendingApprovals } from '@/api/pauseReasons'
import { answerApprovals, getLastRunInputs, getRunInputs } from '@/api/runReview'
import type { ApprovalAnswer, PendingApproval, RunInputs } from '@/api/runReviewTypes'
import { abortRun, startRun } from '@/api/runs'
import type { Agent, FlowSummary, Run } from '@/api/types'
import { AppShell, splitPaneMainClassName } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { useNow } from '@/hooks/useNow'
import { useLoadedData } from '@/hooks/useRunData'
import { useRunLive } from '@/hooks/useRunLive'
import { agentPath, runReviewPath, sampleAgentId } from '@/routes'
import { AgentPluginSetupMessage } from '@/pages/agent-builder/PluginRequirementsMessage'
import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { RunInputsForm } from '@/pages/agent-run/RunInputsForm'
import { RunNarrationFeed } from '@/pages/agent-run/RunNarrationFeed'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { StepProgressList } from '@/pages/agent-run/StepProgressList'
import { HelperRunsCard } from '@/pages/agent-run/HelperRunsCard'
import { buildHelperTree, readRunEnd, settleHelperStatuses } from '@/pages/agent-run/runAbilityEvents'
import { useAgentNames } from '@/hooks/useAgentNames'
import { buildRunSidebarAgents, useRunAgent } from '@/pages/agent-run/runAgentSidebar'
import { summarizeRunInputs } from '@/pages/agent-run/runInputValues'
import { buildRunNarration } from '@/pages/agent-run/runNarration'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { buildRunHeaderMeta, buildSidebarRunStatus, isRunActive } from '@/pages/agent-run/testRunHeader'
import { toRunStepTemplate, useAgentFlowSummary } from '@/pages/agent-run/useRunStepTemplate'
import { toError } from '@/lib/errors'
import { messages } from '@/i18n'

function RunStatusPill({ run }: { run: Run | null }) {
  if (run?.status === 'paused') return <StatusPill tone="amber" size="title">{messages().agentRun.waitingForYou2}</StatusPill>
  if (run?.status === 'failed') return <StatusPill tone="danger" size="title">{messages().agentRun.failed}</StatusPill>
  if (run?.status === 'aborted') return <StatusPill tone="neutral" size="title">{messages().agentRun.stopped}</StatusPill>
  if (run?.status === 'succeeded') return <StatusPill tone="ok" size="title">{messages().agentRun.succeeded}</StatusPill>
  return <StatusPill tone="neutral" size="title">{messages().agentRun.running}</StatusPill>
}

/** What the chat says before the first update arrives. */
function buildNarrationPlaceholder(run: Run | null): string {
  if (run?.status === 'failed') return messages().agentRun.testStopped(run.errorMessage ?? null)
  if (run?.status === 'aborted') return messages().agentRun.youStoppedThisTest
  return messages().agentRun.startingTest
}

/** Scrolls to the approval card and moves focus there. */
function focusApprovalCard(approvalCard: HTMLElement | null): void {
  if (!approvalCard) return
  const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  approvalCard.scrollIntoView?.({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' })
  approvalCard.focus({ preventScroll: true })
}

interface FinishedRunActionsProps {
  agentId: string
  runInputs: RunInputs | null
}

/** "Run again" (same inputs) and "Edit steps", once the test ended without success. */
function FinishedRunActions({ agentId, runInputs }: FinishedRunActionsProps) {
  const { startTest, startError, isStarting } = useStartTestRun(agentId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {startError && <span className="text-[13px] text-danger">{startError.message}</span>}
      <button type="button" disabled={isStarting} onClick={() => void startTest(runInputs ?? {})} className={joinClassNames(runHeaderActionClassNames, 'disabled:cursor-not-allowed disabled:opacity-50')}>
        {isStarting ? messages().agentRun.starting : messages().agentRun.runAgain}
      </button>
      <Link to={agentPath('builder', agentId)} className={runHeaderActionClassNames}>
        {messages().agentRun.editSteps}
      </Link>
    </div>
  )
}

/** "Test with cafe · Bandar Lampung" from the run's inputs; a plain request without them. */
function describeTestRequest(inputs: RunInputs | null): string {
  const inputsSummary = summarizeRunInputs(inputs)
  return inputsSummary ? messages().agentRun.testWith(inputsSummary) : messages().agentRun.testThisAgent
}

/** Answers the run's questions with `answerApprovals`, tracking errors. */
function useApprovalAnswer(runId: string) {
  const [answerError, setAnswerError] = useState<Error | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const answerApproval = async (approval: PendingApproval, answer: ApprovalAnswer) => {
    setIsSubmitting(true)
    setAnswerError(null)
    try {
      await answerApprovals(runId, { [approval.resumeKey]: answer })
    } catch (resumeFailure) {
      setAnswerError(toError(resumeFailure))
    } finally {
      setIsSubmitting(false)
    }
  }

  return { answerError, isSubmitting, answerApproval }
}

/** "2 more questions wait" with a link to the review screen, when a run waits on several at once. */
function MoreQuestionsNotice({ runId, count }: { runId: string; count: number }) {
  return (
    <p className="m-0 text-[13px] text-body">
      {count === 1 ? messages().agentRun.n1MoreQuestionWaits : messages().agentRun.moreQuestionsWait(count)} {messages().agentRun.afterThisOne}{' '}
      <Link to={runReviewPath(runId)} className="font-medium">
        {messages().agentRun.reviewThemTogether}
      </Link>
    </p>
  )
}

interface TestRunScreenProps {
  agentId: string
  agent: Agent | null
  runId: string
  flowSummary: FlowSummary | null
}

/** The run panel and chat for one run id; remounted (fresh state) for every new run. */
function TestRunScreen({ agentId, agent, runId, flowSummary }: TestRunScreenProps) {
  const navigate = useNavigate()
  const { run, events, error: liveError } = useRunLive(runId)
  const { data: runInputs } = useLoadedData(() => getRunInputs(runId), [runId])
  const { answerError, isSubmitting, answerApproval } = useApprovalAnswer(runId)
  const [stopError, setStopError] = useState<Error | null>(null)

  const pendingApprovals = readPendingApprovals(run)
  const firstApproval = pendingApprovals[0]
  const visibleError = liveError ?? answerError ?? stopError
  const stepTemplate = toRunStepTemplate(flowSummary)
  const isActive = isRunActive(run)
  const now = useNow(isActive)
  const steps = buildRunStepViews(stepTemplate, events)
  const agentNames = useAgentNames()
  // The lookup falls back to the id itself: an id is no name to show.
  const nameOfHelper = (helperId: string) => (agentNames(helperId) === helperId ? null : agentNames(helperId))
  const narrationLines = buildRunNarration(stepTemplate, events, nameOfHelper)
  const helpers = settleHelperStatuses(buildHelperTree(events), readRunEnd(events))
  const approvalCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (run?.status !== 'succeeded') return
    navigate(agentPath('runResult', agentId, { runId: run.id }))
  }, [run?.status, run?.id, agentId, navigate])

  const stopTest = async () => {
    const isRunActive = run?.status === 'running' || run?.status === 'paused'
    if (isRunActive) {
      try {
        await abortRun(runId)
      } catch (abortFailure) {
        setStopError(toError(abortFailure))
        return
      }
    }
    navigate(agentPath('builder', agentId))
  }

  return (
    <AppShell agents={buildRunSidebarAgents(agentId, agent, buildSidebarRunStatus(run))} mainClassName={splitPaneMainClassName}>
      <RunWorkspace>
        <BuildChatPanel>
          <UserChatBubble>{describeTestRequest(runInputs)}</UserChatBubble>
          <RunNarrationFeed lines={narrationLines} placeholder={buildNarrationPlaceholder(run)} onOpenApproval={() => focusApprovalCard(approvalCardRef.current)} />
        </BuildChatPanel>

        <RunPanel
          headerAction={
            isActive ? (
              <button type="button" onClick={() => void stopTest()} className={runHeaderActionClassNames}>
                {messages().agentRun.stopRun}
              </button>
            ) : (
              <FinishedRunActions agentId={agentId} runInputs={runInputs} />
            )
          }
        >
          <RunTitleRow meta={buildRunHeaderMeta(run, steps, now)} status={<RunStatusPill run={run} />} />
          {visibleError && <RunErrorNotice title={messages().agentRun.somethingWentWrongWithThisTest} error={visibleError} />}
          <StepProgressList steps={steps} now={now} fixAgentId={agentId} />
          <HelperRunsCard helpers={helpers} nameOf={agentNames} />
          {firstApproval && (
            <div ref={approvalCardRef} id="approval-card" tabIndex={-1} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber">
              <ApprovalCard
                key={`${runId}-${firstApproval.id}`}
                approval={firstApproval}
                isSubmitting={isSubmitting}
                onAnswer={(answer) => void answerApproval(firstApproval, answer)}
              />
            </div>
          )}
          {pendingApprovals.length > 1 && <MoreQuestionsNotice runId={runId} count={pendingApprovals.length - 1} />}
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}

/**
 * Starts the test with the given inputs and puts the new run id in the URL.
 *
 * @returns The start function, whether a start is in flight and its error
 */
function useStartTestRun(agentId: string) {
  const [, setSearchParams] = useSearchParams()
  const [startError, setStartError] = useState<Error | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const startTest = async (inputs: RunInputs) => {
    setIsStarting(true)
    setStartError(null)
    try {
      const startedRun = await startRun(agentId, 'test', inputs)
      if (isMountedRef.current) setSearchParams({ runId: startedRun.id })
    } catch (startFailure) {
      if (isMountedRef.current) setStartError(toError(startFailure))
    } finally {
      if (isMountedRef.current) setIsStarting(false)
    }
  }

  return { startTest, startError, isStarting }
}

interface TestSetupScreenProps {
  agentId: string
  agent: Agent | null
  flowSummary: FlowSummary | null
  flowSummaryError: Error | null
  isFlowSummaryLoading: boolean
}

/** `start_run` refused because plugins the agent uses are not installed, trusted or set up. */
function isMissingPluginsError(startError: Error | null): boolean {
  return startError instanceof BackendError && startError.code === 'missing_plugins'
}

/**
 * Before a test: the flow's inputs as a form (prefilled from the last run) and a Start button.
 * When the start is refused for missing plugins, the chat shows their setup card.
 */
function TestSetupScreen({ agentId, agent, flowSummary, flowSummaryError, isFlowSummaryLoading }: TestSetupScreenProps) {
  const lastInputs = useLoadedData(() => getLastRunInputs(agentId), [agentId])
  const { startTest, startError, isStarting } = useStartTestRun(agentId)
  const isReady = !isFlowSummaryLoading && !lastInputs.isLoading && flowSummary !== null
  const stepTemplate = toRunStepTemplate(flowSummary)

  return (
    <AppShell agents={buildRunSidebarAgents(agentId, agent)} mainClassName={splitPaneMainClassName}>
      <RunWorkspace>
        <BuildChatPanel>
          <BuilderReply>{messages().agentRun.fillInWhatTheTestShould}</BuilderReply>
          {isMissingPluginsError(startError) && <AgentPluginSetupMessage agentId={agentId} />}
        </BuildChatPanel>

        <RunPanel
          headerAction={
            <Link to={agentPath('builder', agentId)} className={runHeaderActionClassNames}>
              {messages().agentRun.backToSteps}
            </Link>
          }
        >
          <RunTitleRow meta={messages().agentRun.notStarted} status={<StatusPill tone="neutral" size="title">{messages().agentRun.ready}</StatusPill>} />
          {flowSummaryError && <RunErrorNotice title={messages().agentRun.couldNotReadThisAgentsSteps} error={flowSummaryError} />}
          {startError && (
            <RunErrorNotice title={isMissingPluginsError(startError) ? messages().agentRun.setUpItsPluginsInThe : messages().agentRun.couldNotStartTheTest} error={startError} />
          )}
          {isReady ? (
            <RunInputsForm inputs={flowSummary.inputs} lastInputs={lastInputs.data} isStarting={isStarting} onStart={(inputs) => void startTest(inputs)} />
          ) : (
            !flowSummaryError && <p className="m-0 text-body">{messages().agentRun.loadingTheAgentsInputs}</p>
          )}
          {stepTemplate.length > 0 && <StepProgressList steps={buildRunStepViews(stepTemplate, [])} />}
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}

/**
 * Screen 06 · Test run and approval (`/agents/:agentId/test`, optional `?runId=`).
 * Without a run id it shows a form built from the flow's inputs (prefilled from the last run);
 * Start runs the test and puts its id in the URL. Steps come from the flow summary and live
 * events. When the run pauses on a `human-input` step, its prompt, form fields and actions show
 * as they are, and the chosen action resumes the run with `{ action, values }`. Stop aborts the
 * run; on success the run result (07) opens.
 */
export function TestRunPage() {
  const { agentId = sampleAgentId } = useParams()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const agent = useRunAgent(agentId)
  const { data: flowSummary, error: flowSummaryError, isLoading: isFlowSummaryLoading } = useAgentFlowSummary(agentId)

  if (!runId) {
    return <TestSetupScreen agentId={agentId} agent={agent} flowSummary={flowSummary} flowSummaryError={flowSummaryError} isFlowSummaryLoading={isFlowSummaryLoading} />
  }
  return <TestRunScreen key={runId} agentId={agentId} agent={agent} runId={runId} flowSummary={flowSummary} />
}
