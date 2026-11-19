import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLastRunInputs } from '@/api/runReview'
import { startRun } from '@/api/runs'
import type { Trigger } from '@/api/types'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { chooseRunNowInputs } from './agentCardState'

type RunNowState = { kind: 'idle' } | { kind: 'starting' } | { kind: 'started' } | { kind: 'failed'; message: string }

async function readLastRunInputs(agentId: string): Promise<Record<string, unknown> | null> {
  try {
    return await getLastRunInputs(agentId)
  } catch {
    // Unknown inputs are not fatal: the test screen asks for them.
    return null
  }
}

interface RunNowButtonProps {
  agentId: string
  agentTriggers: Trigger[]
  label: string
}

/**
 * "Run now" on an active agent's card: starts a manual run with the last inputs (or the
 * schedule's), or opens the test screen to ask for them when none are known.
 */
export function RunNowButton({ agentId, agentTriggers, label }: RunNowButtonProps) {
  const navigate = useNavigate()
  const [runNowState, setRunNowState] = useState<RunNowState>({ kind: 'idle' })

  async function handleRunNow() {
    setRunNowState({ kind: 'starting' })
    const inputs = chooseRunNowInputs(await readLastRunInputs(agentId), agentTriggers)
    if (!inputs) {
      navigate(agentPath('testRun', agentId))
      return
    }
    try {
      await startRun(agentId, 'manual', inputs)
      setRunNowState({ kind: 'started' })
    } catch (startError) {
      setRunNowState({ kind: 'failed', message: describeError(startError) })
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => void handleRunNow()} disabled={runNowState.kind === 'starting'}>
        {runNowState.kind === 'starting' ? 'Starting…' : label}
      </Button>
      {runNowState.kind === 'started' && (
        <span role="status" className="text-[13px] text-ok-strong">
          Run started
        </span>
      )}
      {runNowState.kind === 'failed' && (
        <span role="alert" className="text-[13px] text-danger">
          Could not start: {runNowState.message}
        </span>
      )}
    </span>
  )
}
