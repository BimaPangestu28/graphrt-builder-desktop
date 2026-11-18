import { useCallback, useEffect, useRef, useState } from 'react'
import { buildAgent } from '@/api/builder'
import type { Agent, BuildProgress, BuildRequest, BuildStage, DraftPreview } from '@/api/types'

/**
 * Checklist order on screen 03. Each backend stage marks its line as running; lines
 * before it count as done. Stages may be skipped (no repair needed) and never move
 * the checklist backwards.
 */
export const buildChecklistStages: BuildStage[] = ['understanding', 'drafting', 'repairing', 'checking', 'done']

export interface AgentBuildState {
  /** Index into {@link buildChecklistStages}; equal to its length once the agent is saved. */
  runningItemIndex: number
  /** Latest message the backend sent for each stage. */
  stageMessages: Partial<Record<BuildStage, string>>
  /** Latest preview of what the model is writing (kept after the round ends so its steps stay on screen). */
  draft: DraftPreview | null
  /** Stage the latest preview belongs to (`drafting` or `repairing`). */
  draftStage: BuildStage | null
  /** The model's explanation per writing stage, as far as it has streamed. */
  explanations: Partial<Record<BuildStage, string>>
  builtAgent: Agent | null
  buildError: Error | null
}

const initialBuildState: AgentBuildState = {
  runningItemIndex: 0,
  stageMessages: {},
  draft: null,
  draftStage: null,
  explanations: {},
  builtAgent: null,
  buildError: null,
}

/**
 * Folds one progress update into the build state (pure; exported for tests).
 *
 * @param buildState - State before the update (AgentBuildState)
 * @param progress - Update from the backend (BuildProgress)
 * @returns The next state (AgentBuildState)
 */
export function applyBuildProgress(buildState: AgentBuildState, progress: BuildProgress): AgentBuildState {
  const stageIndex = buildChecklistStages.indexOf(progress.stage)
  const nextState = {
    ...buildState,
    runningItemIndex: Math.max(buildState.runningItemIndex, stageIndex),
    stageMessages: { ...buildState.stageMessages, [progress.stage]: progress.message },
  }
  if (!progress.draft) return nextState
  return {
    ...nextState,
    draft: progress.draft,
    draftStage: progress.stage,
    explanations: { ...buildState.explanations, [progress.stage]: progress.draft.explanation },
  }
}

function toError(rawError: unknown): Error {
  return rawError instanceof Error ? rawError : new Error('Something went wrong')
}

/**
 * Builds an agent once per attempt and tracks its progress for screen 03.
 * The started build is remembered per attempt, so React StrictMode's double effect
 * in development does not draft the agent twice.
 *
 * @param buildRequest - What to build (BuildRequest); read when an attempt starts
 * @returns Build state plus `retry()` to start a new attempt after an error
 */
export function useAgentBuild(buildRequest: BuildRequest): AgentBuildState & { retry: () => void } {
  const [attemptNumber, setAttemptNumber] = useState(0)
  const [buildState, setBuildState] = useState<AgentBuildState>(initialBuildState)
  const startedBuildRef = useRef<{ attemptNumber: number; buildPromise: Promise<Agent> } | null>(null)
  const isMountedRef = useRef(false)
  const buildRequestRef = useRef(buildRequest)
  buildRequestRef.current = buildRequest

  useEffect(() => {
    isMountedRef.current = true
    if (startedBuildRef.current?.attemptNumber !== attemptNumber) {
      const handleProgress = (progress: BuildProgress) => {
        if (isMountedRef.current) setBuildState((previousState) => applyBuildProgress(previousState, progress))
      }
      startedBuildRef.current = { attemptNumber, buildPromise: buildAgent(buildRequestRef.current, handleProgress) }
    }
    let isCurrentEffect = true
    startedBuildRef.current.buildPromise.then(
      (builtAgent) => {
        if (isCurrentEffect) setBuildState((previousState) => ({ ...previousState, builtAgent, runningItemIndex: buildChecklistStages.length }))
      },
      (rawError: unknown) => {
        if (isCurrentEffect) setBuildState((previousState) => ({ ...previousState, buildError: toError(rawError) }))
      },
    )
    return () => {
      isCurrentEffect = false
      isMountedRef.current = false
    }
  }, [attemptNumber])

  const retry = useCallback(() => {
    setBuildState(initialBuildState)
    setAttemptNumber((previousAttempt) => previousAttempt + 1)
  }, [])

  return { ...buildState, retry }
}
