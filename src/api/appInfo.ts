import { callBackend, isDesktopApp } from './client'
import type { AppInfo } from './connectionTypes'
import { sampleAppInfoBackend } from './sampleBackend/appInfo'

/** App version and data folder (Settings > Privacy and data, About). */

export async function getAppInfo(): Promise<AppInfo> {
  if (!isDesktopApp()) return sampleAppInfoBackend.getAppInfo()
  const { getVersion } = await import('@tauri-apps/api/app')
  const [version, dataFolderPath] = await Promise.all([getVersion(), callBackend<string>('get_data_folder_path')])
  // The app has no update check yet, so it does not claim to be up to date.
  return { version, dataFolderPath, updateStatus: null }
}

/** Opens the data folder in Finder (Explorer / the file manager on other systems). */
export function revealDataFolder(): Promise<void> {
  if (!isDesktopApp()) return sampleAppInfoBackend.revealDataFolder()
  return callBackend('reveal_data_folder')
}
