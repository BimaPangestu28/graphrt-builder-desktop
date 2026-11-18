/** Mock data for screen 22 · Settings. */

export type SettingsSectionKey = 'general' | 'runner' | 'notifications' | 'privacy' | 'remote' | 'about'

export const settingsSections: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'runner', label: 'Runner' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'privacy', label: 'Privacy and data' },
  { key: 'remote', label: 'Remote runner' },
  { key: 'about', label: 'About' },
]

export const defaultModelOptions = ['OpenAI gpt-4o-mini', 'Ollama qwen2.5:14b'] as const
export const modelFallbackOptions = ['Switch to Ollama', 'Pause and tell me'] as const
export const runHistoryRetentionOptions = ['30 days', '90 days', 'Forever'] as const
export const appearanceOptions = ['Match the Mac', 'Light', 'Dark'] as const
export const languageOptions = ['English', 'Bahasa Indonesia'] as const

/** Labels of the missed-run policy select, by backend value. */
export const missedRunPolicyLabels = {
  run_once: 'Run it once when the Mac wakes',
  skip: 'Skip it',
} as const

export const dataFolderPath = '~/Library/Application Support/graphrt'
export const appVersion = '0.9.0'
