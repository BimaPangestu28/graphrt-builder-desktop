import { useState } from 'react'
import {
  appearanceOptions,
  defaultModelOptions,
  languageOptions,
  modelFallbackOptions,
  runHistoryRetentionOptions,
} from '@/data/settings'

/**
 * Settings-screen values that have no backend yet and live in memory only. The desktop
 * preferences (login, menu bar, keep awake, notifications) come from `useAppSettings`.
 */
export interface SettingsValues {
  defaultModel: (typeof defaultModelOptions)[number]
  modelFallback: (typeof modelFallbackOptions)[number]
  runHistoryRetention: (typeof runHistoryRetentionOptions)[number]
  shareCrashReports: boolean
  appearance: (typeof appearanceOptions)[number]
  language: (typeof languageOptions)[number]
  notifyNewChatMessages: boolean
  dailySummary: boolean
  remoteServerUrl: string
}

const initialSettingsValues: SettingsValues = {
  defaultModel: 'OpenAI gpt-4o-mini',
  modelFallback: 'Switch to Ollama',
  runHistoryRetention: '30 days',
  shareCrashReports: false,
  appearance: 'Match the Mac',
  language: 'English',
  notifyNewChatMessages: false,
  dailySummary: false,
  remoteServerUrl: '',
}

export type UpdateSetting = <Key extends keyof SettingsValues>(key: Key, value: SettingsValues[Key]) => void

/**
 * Holds the settings values above the section switcher so changes survive
 * moving between sub-sections.
 */
export function useSettingsState() {
  const [settingsValues, setSettingsValues] = useState<SettingsValues>(initialSettingsValues)
  const updateSetting: UpdateSetting = (key, value) => {
    setSettingsValues((previousValues) => ({ ...previousValues, [key]: value }))
  }
  return { settingsValues, updateSetting }
}
