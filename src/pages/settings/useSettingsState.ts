import { useState } from 'react'
import type { AppearanceKey, ModelFallbackKey } from '@/lib/settings'

/**
 * Settings that have no backend yet and live in memory only. The desktop app hides their
 * controls; the browser preview shows them so it matches the design. Everything else
 * (login, menu bar, keep awake, notifications, retention, default model, crash reports) is stored by
 * the backend through `useAppSettings` and the credentials commands.
 */
export interface SettingsValues {
  modelFallback: ModelFallbackKey
  appearance: AppearanceKey
  remoteServerUrl: string
}

const initialSettingsValues: SettingsValues = {
  modelFallback: 'ollama',
  appearance: 'system',
  remoteServerUrl: '',
}

export type UpdateSetting = <Key extends keyof SettingsValues>(key: Key, value: SettingsValues[Key]) => void

/**
 * Holds the preview-only values above the section switcher so changes survive
 * moving between sub-sections.
 */
export function useSettingsState() {
  const [settingsValues, setSettingsValues] = useState<SettingsValues>(initialSettingsValues)
  const updateSetting: UpdateSetting = (key, value) => {
    setSettingsValues((previousValues) => ({ ...previousValues, [key]: value }))
  }
  return { settingsValues, updateSetting }
}
