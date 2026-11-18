import { useState } from 'react'
import {
  appearanceOptions,
  defaultModelOptions,
  languageOptions,
  modelFallbackOptions,
  runHistoryRetentionOptions,
} from '@/data/settings'

/** Every value the settings screen lets the user change. Lives in memory only (no backend). */
export interface SettingsValues {
  startAtLogin: boolean
  showInMenuBar: boolean
  keepMacAwake: boolean
  defaultModel: (typeof defaultModelOptions)[number]
  modelFallback: (typeof modelFallbackOptions)[number]
  runHistoryRetention: (typeof runHistoryRetentionOptions)[number]
  shareCrashReports: boolean
  appearance: (typeof appearanceOptions)[number]
  language: (typeof languageOptions)[number]
  notifyWhenApprovalNeeded: boolean
  notifyWhenRunFails: boolean
  notifyNewChatMessages: boolean
  dailySummary: boolean
  remoteServerUrl: string
}

const initialSettingsValues: SettingsValues = {
  startAtLogin: true,
  showInMenuBar: true,
  keepMacAwake: true,
  defaultModel: 'OpenAI gpt-4o-mini',
  modelFallback: 'Switch to Ollama',
  runHistoryRetention: '30 days',
  shareCrashReports: false,
  appearance: 'Match the Mac',
  language: 'English',
  notifyWhenApprovalNeeded: true,
  notifyWhenRunFails: true,
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
