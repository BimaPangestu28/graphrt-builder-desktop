import type { AppSettings, DeletionSummary, ExportSummary } from '../appSettingsTypes'
import { requireText, respondWith } from './sampleResponse'
import { resetSampleAgents, sampleAgentsBackend } from './agents'
import { resetSampleOnboardingTour } from './onboardingTour'

/**
 * Sample desktop preferences for the browser preview and tests, kept in module memory.
 * Starts from the values shown on the Settings design (screen 22).
 */

function createInitialSettings(): AppSettings {
  return {
    openAtLogin: true,
    showInMenuBar: true,
    notifyOnApproval: true,
    notifyOnFailure: true,
    keepAwakeWhileRunning: true,
    keepAwakeOnlyOnPower: true,
    missedRunDefaultPolicy: 'run_once',
    notifyOnChatHandoff: false,
    notifyDailySummary: false,
    runHistoryRetentionDays: 30,
  }
}

let storedSettings = createInitialSettings()

async function exportSampleAgents(path: string): Promise<ExportSummary> {
  const trimmedPath = requireText(path, 'choose where to save the export')
  const agents = await sampleAgentsBackend.listAgents()
  return { path: trimmedPath, agentCount: agents.length }
}

async function deleteSampleData(removeKeychainItems: boolean): Promise<DeletionSummary> {
  const agents = await sampleAgentsBackend.listAgents()
  await Promise.all(agents.map((agent) => sampleAgentsBackend.deleteAgent(agent.id)))
  storedSettings = createInitialSettings()
  resetSampleOnboardingTour()
  return { deletedAgentCount: agents.length, removedKeychainItemCount: removeKeychainItems ? 3 : 0 }
}

export const sampleAppSettingsBackend = {
  getAppSettings: (): Promise<AppSettings> => respondWith(() => ({ ...storedSettings })),
  updateAppSettings: (settings: AppSettings): Promise<AppSettings> =>
    respondWith(() => {
      storedSettings = { ...settings }
      return { ...storedSettings }
    }),
  exportAgents: (path: string): Promise<ExportSummary> => exportSampleAgents(path),
  deleteAllData: (removeKeychainItems: boolean): Promise<DeletionSummary> => deleteSampleData(removeKeychainItems),
}

/** Restores the sample preferences and agents (use in test `beforeEach`). */
export function resetSampleAppSettings(): void {
  storedSettings = createInitialSettings()
  resetSampleAgents()
}
