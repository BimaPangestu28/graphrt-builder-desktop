import type { PreviewContent } from '../previewContentTypes'
import { sampleSelectedRunId } from './fixtures/runRecords'
import { sampleScheduleTimeZone, sampleScheduleToday, sampleScheduleTriggers } from './fixtures/scheduleTriggers'
import { sampleAgentIdsByName } from './sampleRunSeed'

/** The browser preview's design content; served by `getPreviewContent` in `api/previewContent.ts`. */
export const samplePreviewContent: PreviewContent = {
  agentNamesById: {
    ...Object.fromEntries(Object.entries(sampleAgentIdsByName).map(([agentName, agentId]) => [agentId, agentName])),
    ...Object.fromEntries(sampleScheduleTriggers.map((trigger) => [trigger.id, trigger.agentName])),
  },
  appRequirementsByAgentId: {
    'maps-leads': [
      { label: 'Google Places API key', isConnected: true },
      { label: 'WhatsApp on this computer', isConnected: false },
    ],
  },
  selectedRunId: sampleSelectedRunId,
  scheduler: {
    eventTriggers: sampleScheduleTriggers.filter((trigger) => trigger.iconKind !== 'schedule'),
    triggerOrderById: new Map(sampleScheduleTriggers.map((trigger, index) => [trigger.id, index])),
    shortNamesByAgentId: new Map(sampleScheduleTriggers.map((trigger) => [trigger.id, trigger.shortName])),
    todayIsoDate: sampleScheduleToday,
    timeZone: sampleScheduleTimeZone,
  },
}
