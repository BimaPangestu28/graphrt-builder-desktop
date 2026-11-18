import { callBackend, isDesktopApp } from './client'
import { sampleScheduleRulesBackend } from './sampleBackend/scheduleRules'
import type { ScheduleRules } from './scheduleRuleTypes'
import type { Run } from './types'

/** Scheduler screen (10): enforced schedule rules and the runs schedules started. */

export function getScheduleRules(): Promise<ScheduleRules> {
  if (!isDesktopApp()) return sampleScheduleRulesBackend.getScheduleRules()
  return callBackend('get_schedule_rules')
}

export function updateScheduleRules(rules: ScheduleRules): Promise<ScheduleRules> {
  if (!isDesktopApp()) return sampleScheduleRulesBackend.updateScheduleRules(rules)
  return callBackend('update_schedule_rules', { rules })
}

/**
 * Runs started by a schedule in `[since, until)`, oldest first. The window may be at most 6 weeks.
 *
 * @param since - RFC 3339 start (string)
 * @param until - RFC 3339 end, exclusive (string)
 */
export function listScheduledRuns(since: string, until: string): Promise<Run[]> {
  if (!isDesktopApp()) return sampleScheduleRulesBackend.listScheduledRuns(since, until)
  return callBackend('list_scheduled_runs', { since, until })
}
