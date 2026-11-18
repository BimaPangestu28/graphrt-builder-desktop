import { useCallback, useEffect, useState } from 'react'
import { previewSchedule, setTriggerEnabled, listTriggers } from '@/api/triggers'
import type { Trigger } from '@/api/types'
import { toError, useLoadedData } from './useRunData'

/** Triggers plus an On/Off switch that updates optimistically. */
export interface TriggerList {
  triggers: Trigger[]
  error: Error | null
  isLoading: boolean
  /** Error of the last failed switch, cleared by the next one. */
  toggleError: Error | null
  /** Turns a trigger on or off; reverts the switch if the backend refuses. */
  setEnabled: (triggerId: string, enabled: boolean) => Promise<void>
}

function replaceTrigger(triggers: Trigger[] | null, changedTrigger: Trigger): Trigger[] | null {
  return triggers?.map((trigger) => (trigger.id === changedTrigger.id ? changedTrigger : trigger)) ?? null
}

/**
 * Lists triggers (all, or one agent's) with {@link listTriggers}.
 *
 * @param agentId - Only this agent's triggers when given (string)
 * @returns Triggers, load state and `setEnabled` (TriggerList)
 */
export function useTriggers(agentId?: string): TriggerList {
  const { data, error, isLoading, setData } = useLoadedData(() => listTriggers(agentId), [agentId])
  const [toggleError, setToggleError] = useState<Error | null>(null)

  const setEnabled = useCallback(
    async (triggerId: string, enabled: boolean) => {
      setToggleError(null)
      const previousTrigger = data?.find((trigger) => trigger.id === triggerId)
      if (previousTrigger) setData((currentTriggers) => replaceTrigger(currentTriggers, { ...previousTrigger, enabled }))
      try {
        const savedTrigger = await setTriggerEnabled(triggerId, enabled)
        setData((currentTriggers) => replaceTrigger(currentTriggers, savedTrigger))
      } catch (toggleFailure) {
        if (previousTrigger) setData((currentTriggers) => replaceTrigger(currentTriggers, previousTrigger))
        setToggleError(toError(toggleFailure))
      }
    },
    [data, setData],
  )

  return { triggers: data ?? [], error, isLoading, toggleError, setEnabled }
}

/** Upcoming fire times for the schedule dialog. */
export interface SchedulePreview {
  fireTimes: string[]
  error: Error | null
}

/**
 * Asks the backend when a schedule would fire next. Nothing is requested for a null expression
 * (e.g. "By hand"); results for an older expression are dropped.
 *
 * @param cronExpression - Cron with seconds, or null (string | null)
 * @param timezone - IANA zone (string)
 * @param count - How many times to preview (number)
 */
export function useSchedulePreview(cronExpression: string | null, timezone: string, count = 3): SchedulePreview {
  const [preview, setPreview] = useState<SchedulePreview>({ fireTimes: [], error: null })

  useEffect(() => {
    if (!cronExpression) {
      setPreview({ fireTimes: [], error: null })
      return
    }
    let isCurrent = true
    previewSchedule(cronExpression, timezone, count)
      .then((fireTimes) => {
        if (isCurrent) setPreview({ fireTimes, error: null })
      })
      .catch((previewError: unknown) => {
        if (isCurrent) setPreview({ fireTimes: [], error: toError(previewError) })
      })
    return () => {
      isCurrent = false
    }
  }, [cronExpression, timezone, count])

  return preview
}
