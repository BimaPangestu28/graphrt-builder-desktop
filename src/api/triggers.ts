import { callBackend, isDesktopApp } from './client'
import { sampleTriggersBackend } from './sampleBackend/triggers'
import type { NewTrigger, Trigger } from './types'

/** Schedules. Cron expressions include seconds: "0 0 9 * * Mon-Fri". */

export function listTriggers(agentId?: string): Promise<Trigger[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.listTriggers(agentId)
  return callBackend('list_triggers', { agentId: agentId ?? null })
}

export function createTrigger(newTrigger: NewTrigger): Promise<Trigger> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.createTrigger(newTrigger)
  return callBackend('create_trigger', { newTrigger })
}

export function updateTrigger(triggerId: string, changes: NewTrigger): Promise<Trigger> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.updateTrigger(triggerId, changes)
  return callBackend('update_trigger', { triggerId, changes })
}

export function setTriggerEnabled(triggerId: string, enabled: boolean): Promise<Trigger> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.setTriggerEnabled(triggerId, enabled)
  return callBackend('set_trigger_enabled', { triggerId, enabled })
}

export function deleteTrigger(triggerId: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.deleteTrigger(triggerId)
  return callBackend('delete_trigger', { triggerId })
}

/** Next fire times (RFC 3339) for the schedule dialog. */
export function previewSchedule(cronExpression: string, timezone: string, count = 5): Promise<string[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleTriggersBackend.previewSchedule(cronExpression, timezone, count)
  return callBackend('preview_schedule', { cronExpression, timezone, count })
}
