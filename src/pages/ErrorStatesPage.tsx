import { useSearchParams } from 'react-router-dom'
import { listProblems } from '@/api/problems'
import type { Problem } from '@/api/problemTypes'
import { AppShell } from '@/components/layout'
import { useLoadedData } from '@/hooks/useRunData'
import { FailedRunPanel } from './error-states/FailedRunPanel'
import { OtherProblemsPanel } from './error-states/OtherProblemsPanel'
import { messages } from '@/i18n'

/** The run shown on the left: `?runId=`, else the newest failed run in the problem list. */
function selectRunId(requestedRunId: string | null, problems: Problem[] | null): string | null {
  if (requestedRunId) return requestedRunId
  return problems?.find((problem) => problem.kind === 'failed_run' && problem.runId)?.runId ?? null
}

/**
 * Screen 23 · When something goes wrong.
 * The selected failed run explained in plain words with its fix and "Retry from the start"
 * (graphrt cannot resume a failed run), plus every other problem the backend detects
 * (`listProblems`), each with buttons that open the screen or run the command that fixes it.
 */
export function ErrorStatesPage() {
  const [searchParams] = useSearchParams()
  const { data: problems, error, isLoading } = useLoadedData(listProblems, [])
  const selectedRunId = selectRunId(searchParams.get('runId'), problems)
  const otherProblems = (problems ?? []).filter((problem) => !selectedRunId || problem.runId !== selectedRunId)
  const isWaitingForSelection = !searchParams.get('runId') && isLoading && !problems

  return (
    <AppShell activeNav="runs" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      {isWaitingForSelection ? (
        <section aria-label={messages().agentRun.failedRun} className="box-border flex min-w-0 flex-[3_1_520px] flex-col p-8">
          <p className="m-0 text-body">{messages().agentRun.checkingForProblems}</p>
        </section>
      ) : (
        <FailedRunPanel runId={selectedRunId} />
      )}
      <OtherProblemsPanel problems={otherProblems} isLoading={isLoading} error={error} />
    </AppShell>
  )
}
