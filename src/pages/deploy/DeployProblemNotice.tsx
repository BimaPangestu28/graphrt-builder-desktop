import { useState } from 'react'
import { openDeployFix, signInGoogleCloud } from '@/api/deploy'
import type { DeployProblem } from '@/api/deployTypes'
import { Button } from '@/components/ui'
import { DevelopersDetails } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'
import { describeDeployProblem } from './googleCloud'
import { messages } from '@/i18n'

interface DeployProblemNoticeProps {
  problem: DeployProblem
  /** Smaller text inside a panel. */
  compact?: boolean
}

/**
 * A refusal of the provider in plain words with its fix: a button that opens the console page
 * of the project (billing, permissions…) or signs in with Google again, and what the provider
 * said under Details.
 */
export function DeployProblemNotice({ problem, compact = false }: DeployProblemNoticeProps) {
  const { text, fixLabel } = describeDeployProblem(problem)
  const [isFixing, setIsFixing] = useState(false)
  const [fixMessage, setFixMessage] = useState<string | null>(null)

  async function fix() {
    if (!problem.fix) return
    setFixMessage(null)
    if (problem.fix.kind === 'open_page') {
      await openDeployFix(problem.fix.url).catch((error: unknown) => setFixMessage(plainErrorMessage(error)))
      return
    }
    setIsFixing(true)
    try {
      await signInGoogleCloud()
      setFixMessage(messages().deploy.googleCloud.signedInAgain)
    } catch (error) {
      setFixMessage(plainErrorMessage(error))
    } finally {
      setIsFixing(false)
    }
  }

  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-[12px] border border-danger-line bg-danger-tint px-4 py-3 text-danger-deep">
      <span className={compact ? 'text-[13px] leading-normal' : 'leading-normal'}>{text}</span>
      {fixLabel && (
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void fix()} disabled={isFixing}>
            {isFixing ? messages().deploy.googleCloud.waitingForBrowser : fixLabel}
          </Button>
          {fixMessage && <span className="text-[13px] text-ink-2">{fixMessage}</span>}
        </span>
      )}
      {problem.technical && problem.technical !== text && (
        <DevelopersDetails summary={messages().deploy.googleCloud.whatGoogleSaid}>
          <span className="break-words text-[12px] text-ink-2">{problem.technical}</span>
        </DevelopersDetails>
      )}
    </div>
  )
}
