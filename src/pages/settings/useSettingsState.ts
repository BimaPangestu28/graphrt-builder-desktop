import { useState } from 'react'
import { readStoredAppearance, setAppearance } from '@/lib/appearance'
import type { AppearanceKey, ModelFallbackKey } from '@/lib/settings'

/**
 * Settings the backend does not store. The appearance is real everywhere and kept in this window's storage
 * (`@/lib/appearance`). The model fallback and the remote server have no backend yet and live in memory only:
 * the desktop app hides their controls, the browser preview shows them so it matches the design. Everything
 * else (login, menu bar, keep awake, notifications, retention, default model, crash reports) is stored by the
 * backend through `useAppSettings` and the credentials commands.
 */
export interface SettingsValues {
  modelFallback: ModelFallbackKey
  appearance: AppearanceKey
  remoteServerUrl: string
}

function readInitialSettingsValues(): SettingsValues {
  return { modelFallback: 'ollama', appearance: readStoredAppearance(), remoteServerUrl: '' }
}

export type UpdateSetting = <Key extends keyof SettingsValues>(key: Key, value: SettingsValues[Key]) => void

/**
 * Holds these values above the section switcher so changes survive moving between sub-sections.
 */
export function useSettingsState() {
  const [settingsValues, setSettingsValues] = useState<SettingsValues>(readInitialSettingsValues)
  const updateSetting: UpdateSetting = (key, value) => {
    setSettingsValues((previousValues) => ({ ...previousValues, [key]: value }))
    if (key === 'appearance') setAppearance(value as SettingsValues['appearance'])
  }
  return { settingsValues, updateSetting }
}
