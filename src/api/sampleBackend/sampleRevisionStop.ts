import { BackendError } from '../client'
import { isSampleBuilderBusy, setSampleBuilderBusy } from './agentGraph'

/**
 * Sample "Stop the builder" (`stop_agent_revision`): running sample revisions register
 * here; stopping one rejects it at once with `stopped` ("Stopped by you") and it saves
 * nothing. An agent only marked busy (`setSampleBuilderBusy`, tests) is released too.
 */

export interface SampleRevisionStopSignal {
  /** Rejects with the `stopped` error once the revision is stopped. */
  stopped: Promise<never>
  isStopped: () => boolean
}

interface RegisteredSignal extends SampleRevisionStopSignal {
  stop: () => void
}

const runningRevisions = new Map<string, Set<RegisteredSignal>>()

/** The error a stopped revision ends with (same code and words as the desktop backend). */
export function createStoppedError(): BackendError {
  return new BackendError('stopped', 'Stopped by you')
}

/**
 * Runs `revise` until it ends or the user stops it; `revise` gets the signal to check
 * before it saves anything.
 */
export async function runStoppableSampleRevision<Result>(agentId: string, revise: (signal: SampleRevisionStopSignal) => Promise<Result>): Promise<Result> {
  let rejectStopped: (error: BackendError) => void = () => undefined
  let isStopped = false
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = reject
  })
  stopped.catch(() => undefined)
  const signal: RegisteredSignal = {
    stopped,
    isStopped: () => isStopped,
    stop: () => {
      isStopped = true
      rejectStopped(createStoppedError())
    },
  }
  const signals = runningRevisions.get(agentId) ?? new Set<RegisteredSignal>()
  signals.add(signal)
  runningRevisions.set(agentId, signals)
  try {
    return await Promise.race([revise(signal), stopped])
  } finally {
    signals.delete(signal)
    if (signals.size === 0) runningRevisions.delete(agentId)
  }
}

/** Stops the agent's running sample revisions; true when something was running. */
export function stopSampleRevisions(agentId: string): boolean {
  const signals = [...(runningRevisions.get(agentId) ?? [])]
  signals.forEach((signal) => signal.stop())
  const wasBusy = isSampleBuilderBusy(agentId)
  if (wasBusy) setSampleBuilderBusy(agentId, false)
  return signals.length > 0 || wasBusy
}
