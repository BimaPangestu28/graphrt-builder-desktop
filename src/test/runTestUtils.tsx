import { act } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { sampleRunStepDelayMs } from '@/api/sampleBackend/runs'

/** Steps the scripted sample test run plays before it pauses for approval. */
export const stepsUntilApproval = 11
/** Steps the scripted run plays after "Approve and send" until it succeeds. */
export const stepsAfterApproval = 5

/** Lets pending promises (backend calls) settle inside act. */
export async function flushBackendCalls(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** Advances fake timers by `stepCount` scripted sample-run steps. */
export async function playSampleRunSteps(stepCount: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(sampleRunStepDelayMs * stepCount)
  })
}

/** Prints the current path and query so tests can assert on URL changes. */
export function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
}
