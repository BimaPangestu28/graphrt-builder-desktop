import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, type SetURLSearchParams } from 'react-router-dom'
import { abortRun, resumeRun, startRun } from '@/api/runs'
import type { Run, RunEventRecord } from '@/api/types'
import { AppShell } from '@/components/layout'
import { LinkButton, StrokeIcon } from '@/components/ui'
import { pendingApproval } from '@/data/testRun'
import { defaultScheduleSettings } from '@/data/scheduleAgent'
import { toError } from '@/hooks/useRunData'
import { useRunLive } from '@/hooks/useRunLive'
import { agentPath, sampleAgentId } from '@/routes'
import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import { RunErrorNotice } from '@/pages/agent-run/RunErrorNotice'
import { BuildChatPanel, BuilderReply, RunPanel, RunTitleRow, RunWorkspace, UserChatBubble, runHeaderActionClassNames } from '@/pages/agent-run/RunWorkspace'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { StepProgressList } from '@/pages/agent-run/StepProgressList'
import { buildStepProgress, formatElapsedSince, readApprovalRequest, readPlacesFound, type ApprovalRequest } from '@/pages/agent-run/runProgress'
import { useRunStepTemplate } from '@/pages/agent-run/useRunStepTemplate'

/** Inputs of a test run: the plan's keyword and city, limited to one place. */
const testRunInputs: Record<string, unknown> = {
  keyword: defaultScheduleSettings.searchKeyword,
  city: defaultScheduleSettings.city,
  offer: 'catering menu',
  placeLimit: 1,
}

function WhatsAppConnectedNotice() {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-ok-tint px-3.5 py-2.5 text-ok-strong">
      <StrokeIcon size={16} strokeWidth={2.5}>
        <path d="M5 12.5 10 17 19 7" />
      </StrokeIcon>
      WhatsApp connected as +62 8•• •••• 1204
    </div>
  )
}

/** Shown in place of the approval card after the user skips the only test place. */
function SkippedPlaceNotice({ onRetry, builderPath }: { onRetry: () => void; builderPath: string }) {
  return (
    <section aria-label="Place skipped" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">Skipped this place</h2>
        <span className="text-[13px] text-body">Nothing was sent. The test ends here because it only used 1 place</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="h-10 cursor-pointer rounded-[9px] border-0 bg-ink px-[18px] text-[14px] font-semibold text-white hover:bg-ink-2"
        >
          Test again
        </button>
        <LinkButton to={builderPath} variant="secondary" className="!rounded-[10px] !font-medium !text-ink">
          Back to steps
        </LinkButton>
      </div>
    </section>
  )
}

/**
 * Starts a test run when the URL has no `runId`, then puts the new id in the URL (replacing
 * the entry, so Back does not start another run). Runs once per missing `runId`, also under StrictMode.
 *
 * @returns The error if the run could not be started (Error | null)
 */
function useStartTestRun(agentId: string, runId: string | null, setSearchParams: SetURLSearchParams): Error | null {
  const [startError, setStartError] = useState<Error | null>(null)
  const isStartingRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (runId) {
      isStartingRef.current = false
      return
    }
    if (isStartingRef.current) return
    isStartingRef.current = true
    setStartError(null)
    startRun(agentId, 'test', testRunInputs)
      .then((startedRun) => {
        if (isMountedRef.current) setSearchParams({ runId: startedRun.id }, { replace: true })
      })
      .catch((startFailure: unknown) => {
        isStartingRef.current = false
        if (isMountedRef.current) setStartError(toError(startFailure))
      })
  }, [agentId, runId, setSearchParams])

  return startError
}

type ApprovalAction = 'approve' | 'skip'

/** True when a node the run paused on was then skipped, or the run says it skipped. */
function isRunEndedBySkip(run: Run | null, events: RunEventRecord[]): boolean {
  if (run?.outputs?.skipped === true) return true
  const pausedNodeIds = new Set(events.filter(({ event }) => event.type === 'node_paused').map(({ event }) => event.node_id))
  return events.some(({ event }) => event.type === 'node_skipped' && pausedNodeIds.has(event.node_id))
}

function RunStatusPill({ run, isSkipped }: { run: Run | null; isSkipped: boolean }) {
  if (isSkipped) return <StatusPill tone="neutral" size="title">Ended</StatusPill>
  if (run?.status === 'paused') return <StatusPill tone="amber" size="title">Waiting for you</StatusPill>
  if (run?.status === 'failed') return <StatusPill tone="danger" size="title">Failed</StatusPill>
  if (run?.status === 'aborted') return <StatusPill tone="neutral" size="title">Stopped</StatusPill>
  if (run?.status === 'succeeded') return <StatusPill tone="ok" size="title">Succeeded</StatusPill>
  return <StatusPill tone="neutral" size="title">Running</StatusPill>
}

function buildRunMeta(run: Run | null, placesFound: number | null): string {
  if (!run) return 'Starting the test…'
  const placesPart = placesFound !== null ? `1 of ${placesFound} places · ` : ''
  return `${placesPart}started ${formatElapsedSince(run.startedAt)}`
}

function buildBuilderReply(run: Run | null, placesFound: number | null): string {
  if (run?.status === 'paused') {
    const foundPart = placesFound !== null ? `Found ${placesFound} cafes with a phone number. ` : ''
    return `${foundPart}For this test I am only using the first one. The message is ready and waiting for your OK on the right`
  }
  if (run?.status === 'failed') return `The test stopped: ${run.errorMessage ?? 'something went wrong'}`
  if (run?.status === 'aborted') return 'You stopped this test'
  return 'Running the test with 1 place. Progress shows on the right'
}

interface PendingApprovalProps {
  request: ApprovalRequest
  isSubmitting: boolean
  onAnswer: (action: ApprovalAction, message: string) => void
}

/** The approval card with its own editable draft, reset whenever the run pauses on a new node. */
function PendingApproval({ request, isSubmitting, onAnswer }: PendingApprovalProps) {
  const [draftMessage, setDraftMessage] = useState(request.message)
  return (
    <ApprovalCard
      recipientSummary={request.recipient ?? pendingApproval.recipientSummary}
      message={draftMessage}
      onMessageChange={setDraftMessage}
      onApprove={() => onAnswer('approve', draftMessage)}
      onSkip={() => onAnswer('skip', draftMessage)}
      isSubmitting={isSubmitting}
    />
  )
}

/** Answers the pause with `resumeRun`, tracking the chosen action and errors. */
function useApprovalAnswer(runId: string | null) {
  const [answeredAction, setAnsweredAction] = useState<{ action: ApprovalAction; message: string } | null>(null)
  const [answerError, setAnswerError] = useState<Error | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const answerApproval = async (request: ApprovalRequest, action: ApprovalAction, message: string) => {
    if (!runId) return
    setIsSubmitting(true)
    setAnswerError(null)
    try {
      const values = action === 'approve' ? { message } : {}
      await resumeRun(runId, { [request.nodeId]: { action, values } })
      setAnsweredAction({ action, message })
    } catch (resumeFailure) {
      setAnswerError(toError(resumeFailure))
    } finally {
      setIsSubmitting(false)
    }
  }

  return { answeredAction, answerError, isSubmitting, answerApproval }
}

/** The run panel and chat for one run id; remounted (fresh state) for every new run. */
function TestRunScreen({ agentId, runId, startError }: { agentId: string; runId: string | null; startError: Error | null }) {
  const navigate = useNavigate()
  const { run, events, error: liveError } = useRunLive(runId)
  const stepTemplate = useRunStepTemplate(agentId)
  const { answeredAction, answerError, isSubmitting, answerApproval } = useApprovalAnswer(runId)
  const [stopError, setStopError] = useState<Error | null>(null)

  const approvalRequest = readApprovalRequest(run)
  const placesFound = readPlacesFound(events)
  const isSkipped = answeredAction?.action === 'skip' || (run?.status === 'succeeded' && isRunEndedBySkip(run, events))
  const visibleError = startError ?? liveError ?? answerError ?? stopError

  useEffect(() => {
    if (run?.status !== 'succeeded' || isSkipped) return
    navigate(agentPath('runResult', agentId, { runId: run.id }), { state: { sentMessage: answeredAction?.message } })
  }, [run?.status, run?.id, isSkipped, agentId, answeredAction, navigate])

  const stopTest = async () => {
    const isRunActive = run?.status === 'running' || run?.status === 'paused'
    if (runId && isRunActive) {
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
    <AppShell
      agents={{
        kind: 'draft',
        name: 'Maps leads to WhatsApp',
        status: run?.status === 'paused' ? 'Testing · waiting for you' : 'Testing',
        statusTone: run?.status === 'paused' ? 'amber' : 'brand',
      }}
      runnerStatus="Online · OpenAI connected"
    >
      <RunWorkspace>
        <BuildChatPanel>
          <WhatsAppConnectedNotice />
          <UserChatBubble>Test with 1 place</UserChatBubble>
          <BuilderReply>{buildBuilderReply(run, placesFound)}</BuilderReply>
        </BuildChatPanel>

        <RunPanel
          headerAction={
            <button type="button" onClick={() => void stopTest()} className={runHeaderActionClassNames}>
              Stop run
            </button>
          }
        >
          <RunTitleRow meta={buildRunMeta(run, placesFound)} status={<RunStatusPill run={run} isSkipped={isSkipped} />} />
          {visibleError && <RunErrorNotice title="Something went wrong with this test" error={visibleError} />}
          <StepProgressList steps={buildStepProgress(stepTemplate, events)} />
          {isSkipped ? (
            <SkippedPlaceNotice onRetry={() => navigate(agentPath('testRun', agentId))} builderPath={agentPath('builder', agentId)} />
          ) : (
            approvalRequest && (
              <PendingApproval
                key={`${run?.id}-${approvalRequest.nodeId}`}
                request={approvalRequest}
                isSubmitting={isSubmitting}
                onAnswer={(action, message) => void answerApproval(approvalRequest, action, message)}
              />
            )
          )}
        </RunPanel>
      </RunWorkspace>
    </AppShell>
  )
}

/**
 * Screen 06 · Test run and approval (`/agents/:agentId/test`, optional `?runId=`).
 * Without a run id it starts a test run and puts its id in the URL. Steps fill in from live run
 * events; when the run pauses on "Ask me before sending" the drafted message can be edited and
 * approved or skipped (both resume the run). Stop aborts the run; on success the run result (07) opens.
 */
export function TestRunPage() {
  const { agentId = sampleAgentId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const startError = useStartTestRun(agentId, runId, setSearchParams)
  return <TestRunScreen key={runId ?? 'starting'} agentId={agentId} runId={runId} startError={startError} />
}
