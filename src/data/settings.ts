/** Static option lists and labels for screen 22 · Settings. */

import type { LocalCliProvider, ModelChoice, ModelProvider } from '@/api/types'

export type SettingsSectionKey = 'general' | 'runner' | 'notifications' | 'privacy' | 'remote' | 'updates' | 'about'

export const settingsSections: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'runner', label: 'Runner' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'privacy', label: 'Privacy and data' },
  { key: 'remote', label: 'Remote runner' },
  { key: 'updates', label: 'Updates' },
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
  'claude-code-cli': 'Claude Code (on this computer)',
  'codex-cli': 'Codex (on this computer)',
}

/** The local CLI providers, in the backend's order. */
export const localCliProviders: readonly LocalCliProvider[] = ['claude-code-cli', 'codex-cli']

/** Short names of the local CLIs ("Claude Code"), for sentences. */
export const localCliShortNames: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'Claude Code',
  'codex-cli': 'Codex',
}

/** The command a user types in Terminal to sign a local CLI in. */
export const localCliCommands: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'claude',
  'codex-cli': 'codex',
}

/** Whose plan a local CLI's usage counts against. */
export const localCliPlanNames: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'Claude',
  'codex-cli': 'ChatGPT',
}

/** The model id that means "use the CLI's own default model". */
export const localCliDefaultModelName = 'default'

/** True for the providers that run the user's own signed-in CLI. */
export function isLocalCliProvider(provider: string): provider is LocalCliProvider {
  return provider === 'claude-code-cli' || provider === 'codex-cli'
}

/**
 * The note every local CLI choice carries: Experimental, whose sign-in and plan it uses.
 *
 * @param provider - The local CLI (LocalCliProvider)
 * @returns One plain-language paragraph (string)
 */
export function describeLocalCliUsageNote(provider: LocalCliProvider): string {
  const shortName = localCliShortNames[provider]
  return `Experimental · uses your ${shortName} sign-in on this computer. Usage counts against your ${localCliPlanNames[provider]} plan and its limits. For apps you share with others, use an API key.`
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
