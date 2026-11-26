import { useState } from 'react'
import type { Problem } from '@/api/problemTypes'
import { joinClassNames } from '@/components/ui'
import { CommandOutcomeMessage, ProblemActionControl, type CommandOutcome, type ProblemActionStyle } from './ProblemActionControl'
import { messages } from '@/i18n'

/** Problems waiting on the user lead with a dark button; the others with quieter ones. */
function getActionStyle(problem: Problem, actionIndex: number): ProblemActionStyle {
  if (problem.needsAttention) return actionIndex === 0 ? 'primary' : 'secondary'
  if (problem.actions.length === 1 && problem.actions[0].kind === 'open_schedule') return 'text'
  return actionIndex === 0 ? 'secondary' : 'text'
}

function ProblemCard({ problem }: { problem: Problem }) {
  const [commandOutcome, setCommandOutcome] = useState<CommandOutcome | null>(null)
  const isResolved = commandOutcome?.kind === 'done'
  const hasSingleButton = problem.actions.length === 1 && getActionStyle(problem, 0) !== 'text'

  return (
    <article
      aria-label={problem.title}
      className={joinClassNames(
        'flex flex-col gap-2 rounded-xl border bg-surface p-3.5',
        problem.needsAttention && !isResolved ? 'border-amber-line' : 'border-line',
      )}
    >
      <b className="font-semibold">{problem.title}</b>
      <span className="text-[13px] leading-normal text-ink-2">{problem.detail}</span>
      {commandOutcome && <CommandOutcomeMessage outcome={commandOutcome} />}
      {!isResolved && (
        <div className={joinClassNames('flex flex-wrap items-center gap-2', hasSingleButton && 'self-start')}>
          {problem.actions.map((action, actionIndex) => (
            <ProblemActionControl
              key={`${action.kind}-${action.label}`}
              action={action}
              style={getActionStyle(problem, actionIndex)}
              onCommandFinished={setCommandOutcome}
            />
          ))}
        </div>
      )}
    </article>
  )
}

interface OtherProblemsPanelProps {
  problems: Problem[]
  isLoading: boolean
  error: Error | null
}

/** Right column of screen 23: every other current problem, each with the buttons that fix it. */
export function OtherProblemsPanel({ problems, isLoading, error }: OtherProblemsPanelProps) {
  return (
    <aside
      aria-labelledby="other-problems-heading"
      className="box-border flex min-w-0 flex-[2_1_380px] flex-col gap-3.5 border-l border-line bg-subtle px-6 py-8"
    >
      <h2 id="other-problems-heading" className="m-0 text-[15px] font-semibold">
        {messages().agentRun.otherProblems}
      </h2>
      <span className="text-[13px] leading-normal text-body">{messages().agentRun.eachOneSaysWhatHappenedAnd}</span>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {messages().agentRun.couldNotCheckForProblems}{' '}{error.message}
        </p>
      )}
      {!error && !isLoading && problems.length === 0 && <p className="m-0 text-[13px] text-body">{messages().agentRun.nothingElseNeedsYouRightNow}</p>}
      {problems.map((problem) => (
        <ProblemCard key={problem.id} problem={problem} />
      ))}
    </aside>
  )
}
