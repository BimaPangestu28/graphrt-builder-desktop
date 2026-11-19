/** Static option lists and labels for screen 22 · Settings. */

import type { ModelChoice, ModelProvider } from '@/api/types'

export type SettingsSectionKey = 'general' | 'runner' | 'notifications' | 'privacy' | 'remote' | 'about'

export const settingsSections: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'runner', label: 'Runner' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'privacy', label: 'Privacy and data' },
  { key: 'remote', label: 'Remote runner' },
  { key: 'about', label: 'About' },
]

/**
 * Sections whose controls have no backend yet (appearance and language: the design has
 * no dark theme and the app no translations; the remote runner does not exist). The
 * desktop app hides them; the browser preview shows the full design.
 */
export const previewOnlySettingsSections: readonly SettingsSectionKey[] = ['general', 'remote']

export const modelFallbackOptions = ['Switch to Ollama', 'Pause and tell me'] as const
export const appearanceOptions = ['Match the system', 'Light', 'Dark'] as const
export const languageOptions = ['English', 'Bahasa Indonesia'] as const

/** Display names of the model providers. */
export const modelProviderNames: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
}

/**
 * The small model the backend recommends per key-based provider (`RECOMMENDED_MODELS` in
 * `src-tauri/src/credentials.rs`). Ollama has none: its models depend on what is pulled locally.
 */
export const recommendedModels: ModelChoice[] = [
  { provider: 'openai', name: 'gpt-4o-mini' },
  { provider: 'anthropic', name: 'claude-haiku-5-5' },
  { provider: 'gemini', name: 'gemini-2.5-flash' },
  { provider: 'deepseek', name: 'deepseek-chat' },
]

/** Run history retention choices: days, or null for forever. */
export const runHistoryRetentionChoices: ReadonlyArray<number | null> = [30, 90, null]

/** "30 days" / "Forever". */
export function describeRetention(retentionDays: number | null): string {
  if (retentionDays === null) return 'Forever'
  return retentionDays === 1 ? '1 day' : `${retentionDays} days`
}

/** Labels of the missed-run policy select, by backend value. */
export const missedRunPolicyLabels = {
  run_once: 'Run it once when the computer wakes',
  skip: 'Skip it',
} as const
