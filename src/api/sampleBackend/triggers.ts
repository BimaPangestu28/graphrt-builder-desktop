import { BackendError } from '../client'
import type { NewTrigger, Trigger } from '../types'
import { isKnownTimeZone, listUpcomingFireTimes, parseCronExpression } from '@/lib/schedule'

/**
 * Sample schedules for the browser preview and tests, kept in memory.
 *
 * Seeded from the Scheduler screen (10): the three clock-based triggers. Trigger ids match
 * the agent ids so the Scheduler's mock run history lines up with them.
 * Call {@link resetSampleTriggers} in tests to start from the seed again.
 */

const sampleTimeZone = 'Asia/Jakarta'
const seedCreatedAt = '2026-11-02T02:00:00Z'

interface TriggerSeed {
  id: string
  cronExpression: string
  enabled: boolean
  inputs: Record<string, unknown>
}

const triggerSeeds: TriggerSeed[] = [
  { id: 'maps-leads', cronExpression: '0 0 9 * * Mon-Fri', enabled: true, inputs: { keyword: 'cafe', city: 'Bandar Lampung' } },
  { id: 'morning-digest', cronExpression: '0 0 7 * * *', enabled: true, inputs: {} },
  { id: 'invoice-reminders', cronExpression: '0 0 10 * * Mon', enabled: false, inputs: {} },
]

let storedTriggers: Trigger[] = []
let createdTriggerCount = 0

function computeNextFireAt(cronExpression: string, timezone: string, enabled: boolean): string | null {
  if (!enabled) return null
  return listUpcomingFireTimes(cronExpression, timezone, 1)[0] ?? null
}

function buildSeedTrigger(seed: TriggerSeed): Trigger {
  return {
    id: seed.id,
    agentId: seed.id,
    cronExpression: seed.cronExpression,
    timezone: sampleTimeZone,
    enabled: seed.enabled,
    missedRunPolicy: 'run_once',
    inputs: seed.inputs,
    lastFiredAt: null,
    nextFireAt: computeNextFireAt(seed.cronExpression, sampleTimeZone, seed.enabled),
    createdAt: seedCreatedAt,
  }
}

/** Puts the sample triggers back to the Scheduler screen's seed. */
export function resetSampleTriggers(): void {
  storedTriggers = triggerSeeds.map(buildSeedTrigger)
  createdTriggerCount = 0
}

resetSampleTriggers()

/** @throws BackendError - `schedule` when the expression or zone is not usable */
function validateSchedule(cronExpression: string, timezone: string): void {
  if (!parseCronExpression(cronExpression)) throw new BackendError('schedule', `Could not read the schedule "${cronExpression}"`)
  if (!isKnownTimeZone(timezone)) throw new BackendError('schedule', `Unknown time zone "${timezone}"`)
}

function findTriggerIndex(triggerId: string): number {
  const triggerIndex = storedTriggers.findIndex((trigger) => trigger.id === triggerId)
  if (triggerIndex < 0) throw new BackendError('not_found', `No trigger ${triggerId}`)
  return triggerIndex
}

function replaceTrigger(triggerIndex: number, trigger: Trigger): Trigger {
  storedTriggers = storedTriggers.map((storedTrigger, index) => (index === triggerIndex ? trigger : storedTrigger))
  return { ...trigger }
}

/** Runs `operation` as an async backend call so errors become rejected promises. */
function respond<Result>(operation: () => Result): Promise<Result> {
  try {
    return Promise.resolve(operation())
  } catch (operationError) {
    return Promise.reject(operationError)
  }
}

export const sampleTriggersBackend = {
  listTriggers: (agentId?: string): Promise<Trigger[]> =>
    respond(() => storedTriggers.filter((trigger) => !agentId || trigger.agentId === agentId).map((trigger) => ({ ...trigger }))),

  createTrigger: (newTrigger: NewTrigger): Promise<Trigger> =>
    respond(() => {
      validateSchedule(newTrigger.cronExpression, newTrigger.timezone)
      createdTriggerCount += 1
      const trigger: Trigger = {
        ...newTrigger,
        id: `trigger-${createdTriggerCount}`,
        enabled: true,
        lastFiredAt: null,
        nextFireAt: computeNextFireAt(newTrigger.cronExpression, newTrigger.timezone, true),
        createdAt: new Date().toISOString(),
      }
      storedTriggers = [...storedTriggers, trigger]
      return { ...trigger }
    }),

  updateTrigger: (triggerId: string, changes: NewTrigger): Promise<Trigger> =>
    respond(() => {
      const triggerIndex = findTriggerIndex(triggerId)
      validateSchedule(changes.cronExpression, changes.timezone)
      const currentTrigger = storedTriggers[triggerIndex]
      const nextFireAt = computeNextFireAt(changes.cronExpression, changes.timezone, currentTrigger.enabled)
      return replaceTrigger(triggerIndex, { ...currentTrigger, ...changes, nextFireAt })
    }),

  setTriggerEnabled: (triggerId: string, enabled: boolean): Promise<Trigger> =>
    respond(() => {
      const triggerIndex = findTriggerIndex(triggerId)
      const currentTrigger = storedTriggers[triggerIndex]
      const nextFireAt = computeNextFireAt(currentTrigger.cronExpression, currentTrigger.timezone, enabled)
      return replaceTrigger(triggerIndex, { ...currentTrigger, enabled, nextFireAt })
    }),

  deleteTrigger: (triggerId: string): Promise<void> =>
    respond(() => {
      findTriggerIndex(triggerId)
      storedTriggers = storedTriggers.filter((trigger) => trigger.id !== triggerId)
    }),

  previewSchedule: (cronExpression: string, timezone: string, count: number): Promise<string[]> =>
    respond(() => {
      validateSchedule(cronExpression, timezone)
      return listUpcomingFireTimes(cronExpression, timezone, count)
    }),
}
