import type { AppInfo } from '../connectionTypes'
import { respondWith } from './sampleResponse'

/** Sample app version and data folder, as the Settings design (screen 22) shows them. */
const sampleAppInfo: AppInfo = {
  version: '0.9.0',
  dataFolderPath: '~/Library/Application Support/graphrt',
  updateStatus: 'up to date',
}

export const sampleAppInfoBackend = {
  getAppInfo: (): Promise<AppInfo> => respondWith(() => ({ ...sampleAppInfo })),
  /** The preview has no Finder; the call just succeeds. */
  revealDataFolder: (): Promise<void> => respondWith(() => undefined),
}
