import { useState } from 'react'
import { Link } from 'react-router-dom'
import { installBrowserRuntime } from '@/api/plugins'
import { retryRun } from '@/api/problems'
import type { ProblemAction } from '@/api/problemTypes'
import { joinClassNames } from '@/components/ui'
import { routePaths } from '@/routes'
import { getProblemActionPath } from './problemActions'
import { toError } from '@/lib/errors'

export type ProblemActionStyle = 'primary' | 'secondary' | 'text'

export const problemActionClassNames: Record<ProblemActionStyle, string> = {
  primary: 'h-[34px] cursor-pointer rounded-lg border-0 bg-ink px-3 font-sans text-[13px] font-semibold !text-white no-underline hover:bg-ink-2 disabled:cursor-default disabled:opacity-60',
  secondary:
    'h-[34px] cursor-pointer rounded-lg border border-line-strong bg-surface px-3 font-sans text-[13px] font-medium !text-ink no-underline hover:bg-subtle disabled:cursor-default disabled:opacity-60',
  text: 'cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-medium text-brand-strong',
}

/** What happened after a command button was pressed. */
export type CommandOutcome = { kind: 'done'; message: string; runsPath?: string } | { kind: 'failed'; message: string }

async function runCommand(action: ProblemAction): Promise<CommandOutcome> {
  try {
    if (action.kind === 'retry_run' && action.runId) {
      await retryRun(action.runId)
      return { kind: 'done', message: 'A new run started from the beginning', runsPath: routePaths.runs }
    }
    await installBrowserRuntime()
    return { kind: 'done', message: 'The browser is installed' }
  } catch (commandError) {
    return { kind: 'failed', message: toError(commandError).message }
  }
}

interface ProblemActionControlProps {
  action: ProblemAction
  style: ProblemActionStyle
  onCommandFinished: (outcome: CommandOutcome) => void
}

/** One problem button: a link for navigation, a button for retry / install. */
export function ProblemActionControl({ action, style, onCommandFinished }: ProblemActionControlProps) {
  const [isRunning, setIsRunning] = useState(false)
  const path = getProblemActionPath(action)
  if (path) {
    const isButtonStyled = style !== 'text'
    return (
      <Link to={path} className={joinClassNames(problemActionClassNames[style], isButtonStyled && 'inline-flex items-center')}>
        {action.label}
      </Link>
    )
  }

  async function handleClick() {
    setIsRunning(true)
    const outcome = await runCommand(action)
    setIsRunning(false)
    onCommandFinished(outcome)
  }

  return (
    <button type="button" disabled={isRunning} onClick={() => void handleClick()} className={problemActionClassNames[style]}>
      {action.label}
    </button>
  )
}

/** Shows what a command did, with a link to follow a new run. */
export function CommandOutcomeMessage({ outcome }: { outcome: CommandOutcome }) {
  if (outcome.kind === 'failed') {
    return (
      <p role="status" className="m-0 text-[13px] text-danger">
        {outcome.message}
      </p>
    )
  }
  return (
    <p role="status" className="m-0 text-[13px] text-ok-strong">
      {outcome.message}
      {outcome.runsPath && (
        <>
          {' · '}
          <Link to={outcome.runsPath}>Follow it in Runs</Link>
        </>
      )}
    </p>
  )
}
