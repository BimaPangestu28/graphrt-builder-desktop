import type { LocalCliProvider, ProviderStatus, WelcomeChoice } from '@/api/types'
import { localCliPlanNames, localCliProviders, primaryLocalCliProviders } from '@/lib/settings'
import { apiKeyProviderOptions, type ApiKeyProvider } from './welcomeSetup'
import { messages } from '@/i18n'

/**
 * Step logic of the first-launch Welcome wizard, kept free of React so it can be tested on
 * its own. The wizard asks one plain question per step; at the end its answers become one
 * {@link WelcomeChoice} (the same value the old single-page screen saved).
 */

/** The four plain answers to "How should your agents think?". */
export type WizardApproach = 'existing-account' | 'company-key' | 'private-model' | 'later'

export type WizardStepId = 'welcome' | 'approach' | 'setup' | 'background' | 'done'

/** Short names shown under the progress bar, in order. */
export function wizardStepLabel(stepId: WizardStepId): string {
  return messages().welcome.stepLabels[stepId]
}

/**
 * The steps for an approach. "Decide later" has nothing to connect, so it skips the
 * Connect step; while nothing is picked yet the full list is shown.
 *
 * @param approach - The picked approach, or null (WizardApproach | null)
 * @returns The steps in order (WizardStepId[])
 */
export function wizardStepsFor(approach: WizardApproach | null): WizardStepId[] {
  if (approach === 'later') return ['welcome', 'approach', 'background', 'done']
  return ['welcome', 'approach', 'setup', 'background', 'done']
}

/** The step after `stepId`, or null on the last one. */
export function nextStepId(steps: readonly WizardStepId[], stepId: WizardStepId): WizardStepId | null {
  const stepIndex = steps.indexOf(stepId)
  return stepIndex >= 0 && stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null
}

/** The step before `stepId`, or null on the first one. */
export function previousStepId(steps: readonly WizardStepId[], stepId: WizardStepId): WizardStepId | null {
  const stepIndex = steps.indexOf(stepId)
  return stepIndex > 0 ? steps[stepIndex - 1] : null
}

/**
 * True when the local CLI was found on this computer and starts. One that is found but
 * whose `--version` fails (it has a `problem`) cannot be used, so it does not count.
 */
export function isToolUsable(statuses: readonly ProviderStatus[] | null, provider: LocalCliProvider): boolean {
  const localCli = statuses?.find((status) => status.provider === provider)?.localCli
  return Boolean(localCli?.installed && !localCli.problem)
}

/** The AI tools that were found but do not start (their status has a `problem`), in the usual order. */
export function brokenTools(statuses: readonly ProviderStatus[] | null): LocalCliProvider[] {
  return localCliProviders.filter((provider) => {
    const localCli = statuses?.find((status) => status.provider === provider)?.localCli
    return Boolean(localCli?.installed && localCli.problem)
  })
}

function isToolSignedIn(statuses: readonly ProviderStatus[] | null, provider: LocalCliProvider): boolean {
  return statuses?.find((status) => status.provider === provider)?.localCli?.signIn === 'signed_in'
}

/**
 * The AI tools found on this computer that start, best first: signed in before not
 * confirmed, then Claude Code and Codex, then the others in their usual order. Tools that
 * are found but do not start are left out (see {@link brokenTools}).
 *
 * @param statuses - From `listProviderStatuses`, or null while detection runs (ProviderStatus[] | null)
 * @returns The usable local CLIs (LocalCliProvider[])
 */
export function installedTools(statuses: readonly ProviderStatus[] | null): LocalCliProvider[] {
  const ordered = [...primaryLocalCliProviders, ...localCliProviders.filter((provider) => !primaryLocalCliProviders.includes(provider))]
  const installed = ordered.filter((provider) => isToolUsable(statuses, provider))
  return [...installed.filter((provider) => isToolSignedIn(statuses, provider)), ...installed.filter((provider) => !isToolSignedIn(statuses, provider))]
}

/** The tool picked for "Use an AI account I already have" unless the user picks another. */
export function recommendedTool(statuses: readonly ProviderStatus[] | null): LocalCliProvider | null {
  return installedTools(statuses)[0] ?? null
}

/** What the wizard detected: provider statuses (null while asking) and whether Ollama answers (null while asking). */
export interface WizardDetection {
  statuses: readonly ProviderStatus[] | null
  isOllamaRunning: boolean | null
}

/**
 * The approach preselected for the user: an AI account already signed in on this
 * computer, else Ollama when it runs, else an AI tool that is installed (sign-in not
 * confirmed), else a company API key. Null while detection still runs.
 *
 * @param detection - What was detected (WizardDetection)
 * @returns The recommended approach, or null while unknown (WizardApproach | null)
 */
export function recommendApproach({ statuses, isOllamaRunning }: WizardDetection): WizardApproach | null {
  if (!statuses) return null
  const tools = installedTools(statuses)
  if (tools.some((provider) => isToolSignedIn(statuses, provider))) return 'existing-account'
  if (isOllamaRunning === null) return null
  if (isOllamaRunning) return 'private-model'
  if (tools.length > 0) return 'existing-account'
  return 'company-key'
}

/**
 * Plain name of the account a local CLI uses: "your Claude account". OpenCode can be
 * signed in to several providers, so it gets its own wording.
 */
export function describeAccount(provider: LocalCliProvider): string {
  const t = messages().welcome
  if (provider === 'opencode-cli') return t.accountOpenCode
  return t.account(localCliPlanNames[provider])
}

/** The account name as a title: "Your Claude account". */
export function accountTitle(provider: LocalCliProvider): string {
  const account = describeAccount(provider)
  return account.charAt(0).toUpperCase() + account.slice(1)
}

export type ChoiceGridColumns = 1 | 2 | 3

/**
 * How many columns a grid of `itemCount` equal cards gets on a wide window, so no row is
 * left with a lonely card where it can be avoided: 3 when the cards fill rows of three
 * (3, 6, …), else 2 (2, 4, 5, …; with an odd count the last card stays one column wide,
 * left-aligned), and 1 for a single card.
 *
 * @example
 * choiceGridColumns(4) // 2 (a 2×2 grid)
 */
export function choiceGridColumns(itemCount: number): ChoiceGridColumns {
  if (itemCount <= 1) return 1
  if (itemCount % 3 === 0) return 3
  return 2
}

/** Result of checking a pasted API key before it is saved. */
export type ApiKeyCheck =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  /** Probably fine, but it looks like another provider's key. */
  | { status: 'warning'; message: string; suggestedProvider: ApiKeyProvider | null }
  | { status: 'ok' }

const apiKeyPrefixes: Record<ApiKeyProvider, string> = {
  openai: 'sk-',
  anthropic: 'sk-ant-',
  gemini: 'AIza',
  deepseek: 'sk-',
}

/** The shortest key any of the offered providers hands out is well above this. */
const minimumApiKeyLength = 20

function providerLabel(provider: ApiKeyProvider): string {
  return apiKeyProviderOptions.find((option) => option.provider === provider)?.label ?? provider
}

/** The provider a key's prefix clearly belongs to (Anthropic, Gemini); OpenAI and DeepSeek share `sk-`. */
function providerFromPrefix(apiKey: string): ApiKeyProvider | null {
  if (apiKey.startsWith(apiKeyPrefixes.anthropic)) return 'anthropic'
  if (apiKey.startsWith(apiKeyPrefixes.gemini)) return 'gemini'
  return null
}

/**
 * Checks a pasted key locally (nothing is sent anywhere): blocks an empty key, one with
 * spaces inside or one too short to be real, and warns (without blocking) when the key
 * looks like it belongs to another provider.
 *
 * @param provider - The provider picked in the wizard (ApiKeyProvider)
 * @param apiKey - The key as typed; surrounding spaces are ignored (string)
 * @returns What the wizard shows under the field (ApiKeyCheck)
 *
 * @example
 * checkApiKey('openai', 'sk-ant-…') // { status: 'warning', suggestedProvider: 'anthropic', … }
 */
export function checkApiKey(provider: ApiKeyProvider, apiKey: string): ApiKeyCheck {
  const t = messages().welcome
  const trimmedKey = apiKey.trim()
  if (trimmedKey.length === 0) return { status: 'empty' }
  if (/\s/.test(trimmedKey)) return { status: 'invalid', message: t.keyHasSpaces }
  if (trimmedKey.length < minimumApiKeyLength) return { status: 'invalid', message: t.keyTooShort }
  const prefixProvider = providerFromPrefix(trimmedKey)
  if (prefixProvider && prefixProvider !== provider) {
    return { status: 'warning', message: t.keyFromOtherProvider(providerLabel(prefixProvider), providerLabel(provider)), suggestedProvider: prefixProvider }
  }
  if (!trimmedKey.startsWith(apiKeyPrefixes[provider])) {
    return { status: 'warning', message: t.keyPrefixHint(providerLabel(provider), apiKeyPrefixes[provider]), suggestedProvider: null }
  }
  return { status: 'ok' }
}

/** True when the key can be saved (a warning does not block). */
export function isApiKeyUsable(check: ApiKeyCheck): boolean {
  return check.status === 'ok' || check.status === 'warning'
}

/** Everything the wizard's answers hold. */
export interface WizardAnswers {
  approach: WizardApproach | null
  tool: LocalCliProvider | null
  apiKeyProvider: ApiKeyProvider
  apiKey: string
}

/**
 * Whether Next can leave a step: the Thinking step needs an approach (and a found tool for
 * "an account I already have"); Connect needs a found tool or a usable key. Ollama can be
 * finished later, like on the old screen.
 */
export function canLeaveStep(stepId: WizardStepId, answers: WizardAnswers, statuses: readonly ProviderStatus[] | null): boolean {
  if (stepId === 'approach') {
    if (answers.approach === null) return false
    return answers.approach !== 'existing-account' || installedTools(statuses).length > 0
  }
  if (stepId === 'setup') {
    if (answers.approach === 'existing-account') return answers.tool !== null && isToolUsable(statuses, answers.tool)
    if (answers.approach === 'company-key') return isApiKeyUsable(checkApiKey(answers.apiKeyProvider, answers.apiKey))
    return answers.approach !== null
  }
  return true
}

/**
 * The Welcome choice the answers stand for, as saved by `saveWelcomeSetup`.
 *
 * @returns The choice, or null when the answers are not complete (WelcomeChoice | null)
 */
export function welcomeChoiceFor(answers: WizardAnswers): WelcomeChoice | null {
  switch (answers.approach) {
    case 'existing-account':
      return answers.tool
    case 'company-key':
      return 'api-key'
    case 'private-model':
      return 'ollama'
    case 'later':
      return 'skip'
    default:
      return null
  }
}
