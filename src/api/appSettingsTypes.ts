import type { MissedRunPolicy } from './types'

/**
 * Desktop preferences and data actions of the Settings screen (22). Mirrors the
 * serde types in `src-tauri/src/desktop/app_settings.rs` and `desktop/data.rs`.
 */

export interface AppSettings {
  /** Start graphrt when the user logs in, so schedules fire without opening the app. */
  openAtLogin: boolean
  /** Show the menu bar (tray) icon. */
  showInMenuBar: boolean
  /** Notify when a run waits for approval. */
  notifyOnApproval: boolean
  /** Notify when a run fails. */
  notifyOnFailure: boolean
  /** Keep the computer from sleeping while a run is active. */
  keepAwakeWhileRunning: boolean
  /** Keep awake only on AC power. */
  keepAwakeOnlyOnPower: boolean
  /** Policy proposed for new schedules when a run is missed. */
  missedRunDefaultPolicy: MissedRunPolicy
  /** Notify when a chatbot hands a customer conversation over to the user. */
  notifyOnChatHandoff: boolean
  /** One notification at 18:00 counting the runs of the last 24 hours. */
  notifyDailySummary: boolean
  /** Days the step-by-step logs of finished runs are kept; null keeps them forever. */
  runHistoryRetentionDays: number | null
  /** Download a new version in the background as soon as it is found (installed on restart). */
  autoDownloadUpdates: boolean
  /**
   * Install newer plugin versions in the background when they ask for nothing more than the
   * installed one (never while a run is running or paused). Updates asking for more wait.
   */
  autoUpdatePlugins: boolean
}

export interface ExportSummary {
  /** Absolute path of the written JSON file. */
  path: string
  agentCount: number
}

export interface DeletionSummary {
  deletedAgentCount: number
  /** Provider keys and workflow secrets removed from the keychain. */
  removedKeychainItemCount: number
}

/** Payload of the `open-run` event sent when the user clicks a run notification. */
export interface OpenRunRequest {
  runId: string
  agentId: string
}
