/** Static option lists and labels for screen 22 · Settings. */

import type { LocalCliProvider, ModelChoice, ModelProvider } from '@/api/types'
import { messages } from '@/i18n'

export type SettingsSectionKey = 'general' | 'runner' | 'notifications' | 'privacy' | 'remote' | 'updates' | 'about'

export const settingsSectionKeys: readonly SettingsSectionKey[] = ['general', 'runner', 'notifications', 'privacy', 'remote', 'updates', 'about']

/** The Settings sub-nav entries with their labels in the current language. */
export function listSettingsSections(): Array<{ key: SettingsSectionKey; label: string }> {
  const labels = messages().settings.sections
  return settingsSectionKeys.map((key) => ({ key, label: labels[key] }))
}

/**
 * Sections whose controls have no backend yet (the remote runner does not exist). The
 * desktop app hides them; the browser preview shows the full design. General holds the
 * language (real everywhere) and the appearance (preview only: there is no dark theme yet).
 */
export const previewOnlySettingsSections: readonly SettingsSectionKey[] = ['remote']

export const modelFallbackKeys = ['ollama', 'pause'] as const
export type ModelFallbackKey = (typeof modelFallbackKeys)[number]
export const appearanceKeys = ['system', 'light', 'dark'] as const
export type AppearanceKey = (typeof appearanceKeys)[number]

/** Display names of the model providers. */
export const modelProviderNames: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  get 'claude-code-cli'() {
    return messages().settings.onThisComputer('Claude Code')
  },
  get 'codex-cli'() {
    return messages().settings.onThisComputer('Codex')
  },
  get 'gemini-cli'() {
    return messages().settings.onThisComputer('Gemini CLI')
  },
  get 'cursor-cli'() {
    return messages().settings.onThisComputer('Cursor CLI')
  },
  get 'copilot-cli'() {
    return messages().settings.onThisComputer('GitHub Copilot CLI')
  },
  get 'opencode-cli'() {
    return messages().settings.onThisComputer('OpenCode')
  },
  get 'qwen-code-cli'() {
    return messages().settings.onThisComputer('Qwen Code')
  },
}

/** The local CLI providers, in the backend's order (`LocalCli::ALL`). */
export const localCliProviders: readonly LocalCliProvider[] = [
  'claude-code-cli',
  'codex-cli',
  'gemini-cli',
  'cursor-cli',
  'copilot-cli',
  'opencode-cli',
  'qwen-code-cli',
]

/** The local CLIs offered up front (Welcome cards, always shown on Connections). */
export const primaryLocalCliProviders: readonly LocalCliProvider[] = ['claude-code-cli', 'codex-cli']

/** The other local CLIs, behind "More AI tools on this computer" on Welcome. */
export const moreLocalCliProviders: readonly LocalCliProvider[] = localCliProviders.filter((provider) => !primaryLocalCliProviders.includes(provider))

/** Short names of the local CLIs ("Claude Code"), for sentences. */
export const localCliShortNames: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'Claude Code',
  'codex-cli': 'Codex',
  'gemini-cli': 'Gemini CLI',
  'cursor-cli': 'Cursor CLI',
  'copilot-cli': 'GitHub Copilot CLI',
  'opencode-cli': 'OpenCode',
  'qwen-code-cli': 'Qwen Code',
}

/** The command a user types in Terminal to sign a local CLI in. */
export const localCliCommands: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'cursor-cli': 'cursor-agent login',
  'copilot-cli': 'copilot',
  'opencode-cli': 'opencode auth login',
  'qwen-code-cli': 'qwen',
}

/** Whose plan a local CLI's usage counts against. */
export const localCliPlanNames: Record<LocalCliProvider, string> = {
  'claude-code-cli': 'Claude',
  'codex-cli': 'ChatGPT',
  'gemini-cli': 'Google (Gemini)',
  'cursor-cli': 'Cursor',
  'copilot-cli': 'GitHub Copilot',
  get 'opencode-cli'() {
    return messages().settings.aiProvider
  },
  'qwen-code-cli': 'Qwen',
}

/** The model id that means "use the CLI's own default model". */
export const localCliDefaultModelName = 'default'

/** True for the providers that run the user's own signed-in CLI. */
export function isLocalCliProvider(provider: string): provider is LocalCliProvider {
  return (localCliProviders as readonly string[]).includes(provider)
}

/**
 * The note every local CLI choice carries: Experimental, whose sign-in and plan it uses.
 *
 * @param provider - The local CLI (LocalCliProvider)
 * @returns One plain-language paragraph (string)
 */
export function describeLocalCliUsageNote(provider: LocalCliProvider): string {
  const t = messages().settings
  const shortName = localCliShortNames[provider]
  const planText = provider === 'opencode-cli' ? t.usageNoteOpenCode : t.usageNotePlan(localCliPlanNames[provider])
  return t.usageNote(shortName, planText)
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
  const t = messages().settings
  if (retentionDays === null) return t.retentionForever
  return t.retentionDays(retentionDays)
}

/** Labels of the missed-run policy select, by backend value, in the current language. */
export function missedRunPolicyLabels(): Record<'run_once' | 'skip', string> {
  return messages().settings.missedRunOptions
}
