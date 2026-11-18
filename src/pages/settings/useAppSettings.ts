import { useState } from 'react'
import { getAppSettings, updateAppSettings } from '@/api/appSettings'
import type { AppSettings } from '@/api/appSettingsTypes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'

export type UpdateAppSetting = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => Promise<void>

export interface AppSettingsState {
  /** The saved preferences; the latest change shows right away, before the save finishes. */
  appSettings: AppSettings | null
  isLoading: boolean
  loadError: Error | null
  /** Why the latest save failed (the toggle is put back), or null. */
  saveError: string | null
  updateAppSetting: UpdateAppSetting
  reload: () => Promise<void>
}

/**
 * Loads the desktop preferences (launch at login, menu bar, notifications, keep awake)
 * and saves each change immediately. A failed save restores the previous value.
 *
 * @returns The preferences with load/save state (AppSettingsState)
 */
export function useAppSettings(): AppSettingsState {
  const { data: loadedSettings, error: loadError, isLoading, reload } = useAsyncData(getAppSettings, [])
  const [pendingSettings, setPendingSettings] = useState<AppSettings | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const appSettings = pendingSettings ?? loadedSettings

  const updateAppSetting: UpdateAppSetting = async (key, value) => {
    if (!appSettings) return
    const changedSettings: AppSettings = { ...appSettings, [key]: value }
    setPendingSettings(changedSettings)
    setSaveError(null)
    try {
      setPendingSettings(await updateAppSettings(changedSettings))
    } catch (saveFailure) {
      setPendingSettings(appSettings)
      setSaveError(describeError(saveFailure))
    }
  }

  const reloadSettings = async () => {
    setPendingSettings(null)
    await reload()
  }

  return { appSettings, isLoading, loadError, saveError, updateAppSetting, reload: reloadSettings }
}
