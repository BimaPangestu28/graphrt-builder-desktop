import { detectDesktopPlatform, type DesktopPlatform } from '@/lib/platform'
import type { AppInfo } from '../connectionTypes'
import { respondWith } from './sampleResponse'

/** Where the app data folder usually is on each system (Tauri's app data dir). */
const sampleDataFolderPaths: Record<DesktopPlatform, string> = {
  macos: '~/Library/Application Support/graphrt',
  windows: '%APPDATA%\\graphrt',
  linux: '~/.local/share/graphrt',
}

/** Sample app version and data folder, as the Settings design (screen 22) shows them. */
const sampleAppInfo: AppInfo = {
  version: '0.9.0',
  dataFolderPath: sampleDataFolderPaths[detectDesktopPlatform()],
  updateStatus: 'up to date',
}

export const sampleAppInfoBackend = {
  getAppInfo: (): Promise<AppInfo> => respondWith(() => ({ ...sampleAppInfo })),
  /** The preview has no file manager; the call just succeeds. */
  revealDataFolder: (): Promise<void> => respondWith(() => undefined),
}
