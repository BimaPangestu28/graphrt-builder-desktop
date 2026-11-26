import type { PluginAutoUpdate, PluginCatalogEntry } from '@/api/pluginTypes'
import { findPluginDisplayName, pluginDisplayName, type NamedPlugin } from '@/lib/pluginDisplayName'
import type { UpdateStatus } from '@/pages/updates/updateContext'
import { messages } from '@/i18n'

/** How long "Updated automatically" stays on Home. */
export const recentAutoUpdateWindowMs = 24 * 60 * 60 * 1000
/** localStorage key holding the line keys the user dismissed. */
export const updatesNoticeDismissedKey = 'graphrt.home.updatesNoticeDismissed'

/** What a notice line offers. */
export type UpdatesNoticeAction =
  /** Restart into the downloaded app update (with the busy-runs choice). */
  | { kind: 'restart' }
  /** Download the app update that was found. */
  | { kind: 'download' }
  /** Install the plugin updates that ask for nothing more, plus a Review link. */
  | { kind: 'updateAll'; reviewPath: string }
  | { kind: 'review'; path: string }
  | { kind: 'none' }

export interface UpdatesNoticeLine {
  /** Stable while nothing new appears: dismissing remembers these. */
  key: string
  text: string
  action: UpdatesNoticeAction
  /** Needs the user's approval (amber text). */
  needsApproval: boolean
}

export interface UpdatesNoticeInputs {
  /** Null outside the update provider. */
  appStatus: UpdateStatus | null
  pendingUpdates: PluginCatalogEntry[]
  autoUpdates: PluginAutoUpdate[]
  now: Date
  /** Where "Review" goes for several plugins, e.g. `/plugins?tab=updates`. */
  updatesListPath: string
  /** Where "Review" goes for one plugin. */
  pluginPath: (name: string) => string
  /** Plugins with display names (the catalog), for automatic updates that only carry a name. */
  knownPlugins?: NamedPlugin[]
}

function buildAppLine(status: UpdateStatus | null): UpdatesNoticeLine | null {
  if (!status) return null
  const t = messages().home
  switch (status.kind) {
    case 'ready':
      return { key: `app:ready:${status.update.version}`, text: t.appReady(status.update.version), action: { kind: 'restart' }, needsApproval: false }
    case 'downloading': {
      const percentText = status.percent === null ? '' : ` ${status.percent}%`
      return { key: `app:${status.update.version}`, text: t.appDownloading(status.update.version, percentText), action: { kind: 'none' }, needsApproval: false }
    }
    case 'available':
      return { key: `app:${status.update.version}`, text: t.appAvailable(status.update.version), action: { kind: 'download' }, needsApproval: false }
    default:
      return null
  }
}

function pluralizeUpdates(count: number): string {
  return messages().home.pluginUpdates(count)
}

function versionKey(entries: PluginCatalogEntry[]): string {
  return entries.map((entry) => `${entry.name}@${entry.version}`).join(',')
}

function buildReadyPluginLine(readyUpdates: PluginCatalogEntry[], inputs: UpdatesNoticeInputs): UpdatesNoticeLine | null {
  if (readyUpdates.length === 0) return null
  const t = messages().home
  const text = readyUpdates.length === 1 ? t.pluginVersionAvailable(pluginDisplayName(readyUpdates[0]), readyUpdates[0].version) : t.updatesAvailable(pluralizeUpdates(readyUpdates.length))
  return { key: `plugins:${versionKey(readyUpdates)}`, text, action: { kind: 'updateAll', reviewPath: inputs.updatesListPath }, needsApproval: false }
}

function buildApprovalLine(approvalUpdates: PluginCatalogEntry[], inputs: UpdatesNoticeInputs): UpdatesNoticeLine | null {
  if (approvalUpdates.length === 0) return null
  const [firstUpdate] = approvalUpdates
  const isSingle = approvalUpdates.length === 1
  const t = messages().home
  const text = isSingle ? t.oneNeedsApproval(pluginDisplayName(firstUpdate), firstUpdate.version) : t.manyNeedApproval(pluralizeUpdates(approvalUpdates.length))
  const path = isSingle ? inputs.pluginPath(firstUpdate.name) : inputs.updatesListPath
  return { key: `approval:${versionKey(approvalUpdates)}`, text, action: { kind: 'review', path }, needsApproval: true }
}

function buildAutoUpdateLine(autoUpdates: PluginAutoUpdate[], inputs: UpdatesNoticeInputs): UpdatesNoticeLine | null {
  const { now, knownPlugins = [] } = inputs
  const recentUpdates = autoUpdates.filter((autoUpdate) => {
    const updatedAt = Date.parse(autoUpdate.updatedAt)
    return Number.isFinite(updatedAt) && now.getTime() - updatedAt < recentAutoUpdateWindowMs
  })
  if (recentUpdates.length === 0) return null
  const t = messages().home
  const changes = recentUpdates.map((autoUpdate) => t.autoUpdateChange(findPluginDisplayName(knownPlugins, autoUpdate.name), autoUpdate.fromVersion, autoUpdate.toVersion))
  const key = `auto:${recentUpdates.map((autoUpdate) => `${autoUpdate.name}@${autoUpdate.toVersion}@${autoUpdate.updatedAt}`).join(',')}`
  return { key, text: t.updatedAutomatically(changes.join(', ')), action: { kind: 'none' }, needsApproval: false }
}

/**
 * The lines of Home's Updates notice, most actionable first: the app update, plugin
 * updates ready to install, plugin updates needing approval, then plugins updated
 * automatically in the last 24 hours.
 *
 * @param inputs - Updater status, pending and automatic plugin updates, now and paths (UpdatesNoticeInputs)
 * @returns The lines; empty when there is nothing to say (UpdatesNoticeLine[])
 *
 * @example
 * buildUpdatesNoticeLines({ appStatus: null, pendingUpdates: [], autoUpdates: [], now: new Date(), updatesListPath: '/plugins?tab=updates', pluginPath: (name) => `/plugins/${name}` }) // []
 */
export function buildUpdatesNoticeLines(inputs: UpdatesNoticeInputs): UpdatesNoticeLine[] {
  const readyUpdates = inputs.pendingUpdates.filter((entry) => !entry.updateNeedsApproval)
  const approvalUpdates = inputs.pendingUpdates.filter((entry) => entry.updateNeedsApproval)
  const lines = [
    buildAppLine(inputs.appStatus),
    buildReadyPluginLine(readyUpdates, inputs),
    buildApprovalLine(approvalUpdates, inputs),
    buildAutoUpdateLine(inputs.autoUpdates, inputs),
  ]
  return lines.filter((line): line is UpdatesNoticeLine => line !== null)
}

/** Whether a line the user has not dismissed is among `lines` (something new appeared). */
export function hasUndismissedLine(lines: UpdatesNoticeLine[], dismissedKeys: ReadonlySet<string>): boolean {
  return lines.some((line) => !dismissedKeys.has(line.key))
}

/** The dismissed line keys; empty when storage is unavailable or unreadable. */
export function readDismissedUpdateKeys(): Set<string> {
  try {
    const storedText = window.localStorage.getItem(updatesNoticeDismissedKey)
    const storedKeys: unknown = storedText ? JSON.parse(storedText) : []
    return new Set(Array.isArray(storedKeys) ? storedKeys.filter((key): key is string => typeof key === 'string') : [])
  } catch (storageError) {
    console.warn('Could not read the dismissed updates', storageError)
    return new Set()
  }
}

/** Remembers `keys` as dismissed (best effort: the notice still hides for this visit). */
export function writeDismissedUpdateKeys(keys: Iterable<string>): void {
  try {
    window.localStorage.setItem(updatesNoticeDismissedKey, JSON.stringify([...keys]))
  } catch (storageError) {
    console.warn('Could not remember the dismissed updates', storageError)
  }
}
