import { useCallback, useEffect, useState } from 'react'
import { getAppSettings, updateAppSettings } from '@/api/appSettings'
import type { AppSettings } from '@/api/appSettingsTypes'
import { getScheduleRules, updateScheduleRules } from '@/api/scheduleRules'
import type { ScheduleRules } from '@/api/scheduleRuleTypes'
import { toError } from '@/hooks/useRunData'

/** The rules the Scheduler's "Rules for every schedule" panel edits, and where each is stored. */
export interface ScheduleRuleValues {
  /** `AppSettings.missedRunDefaultPolicy`: what new schedules do after the Mac slept. */
  missedRunDefaultPolicy: AppSettings['missedRunDefaultPolicy']
  /** `AppSettings.keepAwakeWhileRunning`. */
  keepAwakeWhileRunning: boolean
  /** `ScheduleRules.maxConcurrentRuns`, enforced by the scheduler. */
  maxConcurrentRuns: number
}

export interface ScheduleRulesState {
  values: ScheduleRuleValues | null
  error: Error | null
  /** Saves one rule; the control shows the new value at once and reverts if saving fails. */
  saveRule: <Key extends keyof ScheduleRuleValues>(key: Key, value: ScheduleRuleValues[Key]) => Promise<void>
}

async function saveRuleValue<Key extends keyof ScheduleRuleValues>(key: Key, value: ScheduleRuleValues[Key]): Promise<void> {
  if (key === 'maxConcurrentRuns') {
    const rules: ScheduleRules = { maxConcurrentRuns: value as number }
    await updateScheduleRules(rules)
    return
  }
  // Read the latest settings so a change made on the Settings screen meanwhile is kept.
  const currentSettings = await getAppSettings()
  await updateAppSettings({ ...currentSettings, [key]: value })
}

/**
 * Loads the schedule rules from app settings and the scheduler rules, and saves each change.
 *
 * @returns The current values, the last error and `saveRule` (ScheduleRulesState)
 */
export function useScheduleRules(): ScheduleRulesState {
  const [values, setValues] = useState<ScheduleRuleValues | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let isCurrent = true
    Promise.all([getAppSettings(), getScheduleRules()])
      .then(([appSettings, rules]) => {
        if (!isCurrent) return
        setValues({
          missedRunDefaultPolicy: appSettings.missedRunDefaultPolicy,
          keepAwakeWhileRunning: appSettings.keepAwakeWhileRunning,
          maxConcurrentRuns: rules.maxConcurrentRuns,
        })
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(toError(loadError))
      })
    return () => {
      isCurrent = false
    }
  }, [])

  const saveRule = useCallback(
    async <Key extends keyof ScheduleRuleValues>(key: Key, value: ScheduleRuleValues[Key]) => {
      const previousValues = values
      if (!previousValues) return
      setError(null)
      setValues({ ...previousValues, [key]: value })
      try {
        await saveRuleValue(key, value)
      } catch (saveError) {
        setValues(previousValues)
        setError(toError(saveError))
      }
    },
    [values],
  )

  return { values, error, saveRule }
}
