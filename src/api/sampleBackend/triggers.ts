import type { NewTrigger, Trigger } from '../types'
import { sampleNotImplemented } from './notImplemented'

/** Sample schedules for the browser preview and tests. */
export const sampleTriggersBackend = {
  listTriggers: (_agentId?: string): Promise<Trigger[]> => Promise.resolve([]),
  createTrigger: (_newTrigger: NewTrigger): Promise<Trigger> => sampleNotImplemented('createTrigger'),
  updateTrigger: (_triggerId: string, _changes: NewTrigger): Promise<Trigger> => sampleNotImplemented('updateTrigger'),
  setTriggerEnabled: (_triggerId: string, _enabled: boolean): Promise<Trigger> => sampleNotImplemented('setTriggerEnabled'),
  deleteTrigger: (_triggerId: string): Promise<void> => Promise.resolve(),
  previewSchedule: (_cronExpression: string, _timezone: string, _count: number): Promise<string[]> => Promise.resolve([]),
}
