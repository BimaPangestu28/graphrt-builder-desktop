import { useState } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { otherProblems, type OtherProblem, type ProblemAction } from '@/data/errorStates'

const actionClassNames = {
  primary: 'h-[34px] cursor-pointer rounded-lg border-0 bg-ink px-3 font-sans text-[13px] font-semibold !text-white no-underline hover:bg-ink-2',
  secondary:
    'h-[34px] cursor-pointer rounded-lg border border-line-strong bg-surface px-3 font-sans text-[13px] font-medium !text-ink no-underline hover:bg-subtle',
  text: 'text-[13px] font-medium',
} as const

function ProblemActionControl({ action, onDismiss }: { action: ProblemAction; onDismiss: (message: string) => void }) {
  if (action.kind === 'dismiss') {
    return (
      <button type="button" onClick={() => onDismiss(action.resolvedMessage)} className={actionClassNames[action.style]}>
        {action.label}
      </button>
    )
  }
  const isButtonStyled = action.style !== 'text'
  return (
    <Link to={action.to} className={joinClassNames(actionClassNames[action.style], isButtonStyled && 'inline-flex items-center')}>
      {action.label}
    </Link>
  )
}

function ProblemCard({ problem }: { problem: OtherProblem }) {
  const [resolvedMessage, setResolvedMessage] = useState<string | null>(null)
  const hasSingleButton = problem.actions.length === 1 && problem.actions[0].style !== 'text'

  return (
    <article
      aria-label={problem.title}
      className={joinClassNames(
        'flex flex-col gap-2 rounded-xl border bg-surface p-3.5',
        problem.needsAttention && !resolvedMessage ? 'border-amber-line' : 'border-line',
      )}
    >
      <b className="font-semibold">{problem.title}</b>
      <span className="text-[13px] leading-normal text-ink-2">{problem.description}</span>
      {resolvedMessage ? (
        <p role="status" className="m-0 text-[13px] text-ok-strong">
          {resolvedMessage}
        </p>
      ) : (
        <div className={joinClassNames('flex flex-wrap gap-2', hasSingleButton && 'self-start')}>
          {problem.actions.map((action) => (
            <ProblemActionControl key={action.label} action={action} onDismiss={setResolvedMessage} />
          ))}
        </div>
      )}
    </article>
  )
}

/** Right column of screen 23: other recoverable problems, each with one fixing action. */
export function OtherProblemsPanel() {
  return (
    <aside
      aria-labelledby="other-problems-heading"
      className="box-border flex min-w-0 flex-[2_1_380px] flex-col gap-3.5 border-l border-line bg-subtle px-6 py-8"
    >
      <h2 id="other-problems-heading" className="m-0 text-[15px] font-semibold">
        Other problems, same pattern
      </h2>
      <span className="text-[13px] leading-normal text-body">
        Say what happened in plain words, what is safe, then one button that fixes it
      </span>
      {otherProblems.map((problem) => (
        <ProblemCard key={problem.id} problem={problem} />
      ))}
    </aside>
  )
}
