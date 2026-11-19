import { useState, type FormEvent } from 'react'
import { getCredentialStoreName, getTrayAreaName } from '@/lib/platform'
import { Link, useNavigate } from 'react-router-dom'
import { setApiKey, setDefaultModel, setOllamaBaseUrl } from '@/api/credentials'
import type { ModelChoice, ModelProvider } from '@/api/types'
import { LogoMark } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { routePaths } from '@/routes'
import { LockIcon } from './agent-builder/LockIcon'

const aiProviders = ['OpenAI', 'Anthropic', 'Google Gemini', 'DeepSeek', 'Ollama (local)'] as const
type AiProvider = (typeof aiProviders)[number]

/** Backend provider and the recommended small model for each option in the picker. */
const modelChoiceByProvider: Record<AiProvider, ModelChoice> = {
  OpenAI: { provider: 'openai', name: 'gpt-4o-mini' },
  Anthropic: { provider: 'anthropic', name: 'claude-haiku-5-5' },
  'Google Gemini': { provider: 'gemini', name: 'gemini-2.5-flash' },
  DeepSeek: { provider: 'deepseek', name: 'deepseek-chat' },
  'Ollama (local)': { provider: 'ollama', name: 'llama3.2' },
}

const defaultOllamaBaseUrl = 'http://localhost:11434'

/**
 * Stores the chosen provider's key (or the local Ollama address) and makes its
 * recommended model the default for new agents.
 *
 * @throws BackendError - when the key or setting cannot be saved
 */
async function saveModelSetup(provider: AiProvider, apiKey: string): Promise<void> {
  const modelChoice = modelChoiceByProvider[provider]
  const backendProvider: ModelProvider = modelChoice.provider
  if (backendProvider === 'ollama') await setOllamaBaseUrl(defaultOllamaBaseUrl)
  else await setApiKey(backendProvider, apiKey.trim())
  await setDefaultModel(modelChoice)
}

const fieldClassNames = 'box-border h-10 rounded-[10px] border border-line-strong bg-surface text-[14px] text-ink'

/** Disabled "graphrt credits" option, shown so people know a keyless path is coming. */
function CreditsOption() {
  return (
    <label aria-disabled="true" className="flex cursor-not-allowed gap-3.5 rounded-[14px] border border-dashed border-line-strong bg-subtle p-4">
      <input type="radio" name="ai" value="credits" disabled className="mt-[3px] size-[18px]" />
      <span className="flex flex-auto flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold text-body">graphrt credits</span>
          <span className="rounded-full bg-selected px-2 py-0.5 text-[11px] font-semibold tracking-[0.2px] text-ink-2">Soon</span>
        </span>
        <span className="leading-normal text-muted">Sign in and start without an API key. Coming soon</span>
      </span>
    </label>
  )
}

interface ApiKeyOptionProps {
  provider: AiProvider
  apiKey: string
  onProviderChange: (provider: AiProvider) => void
  onApiKeyChange: (apiKey: string) => void
}

/** The selected "bring your own key" option with provider picker and key field. */
function ApiKeyOption({ provider, apiKey, onProviderChange, onApiKeyChange }: ApiKeyOptionProps) {
  const isLocalModel = provider === 'Ollama (local)'
  return (
    <label className="flex cursor-pointer gap-3.5 rounded-[14px] border-2 border-ink bg-surface p-4">
      <input type="radio" name="ai" value="byok" defaultChecked className="mt-[3px] size-[18px] accent-brand" />
      <span className="flex flex-auto flex-col gap-3">
        <span className="flex flex-col gap-1">
          <span className="font-semibold">My own API key</span>
          <span className="leading-normal text-body">OpenAI, Anthropic, Gemini, DeepSeek, or a local model through Ollama. Free</span>
        </span>
        <span className="grid grid-cols-2 gap-2.5">
          <span className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">Provider</span>
            <select aria-label="Provider" value={provider} onChange={(event) => onProviderChange(event.target.value as AiProvider)} className={`${fieldClassNames} px-2.5`}>
              {aiProviders.map((providerName) => (
                <option key={providerName}>{providerName}</option>
              ))}
            </select>
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">API key</span>
            <input
              type="password"
              aria-label="API key"
              value={apiKey}
              disabled={isLocalModel}
              placeholder={isLocalModel ? 'Not needed for Ollama' : 'sk-proj-xxxxxxxxxxxx'}
              onChange={(event) => onApiKeyChange(event.target.value)}
              className={`${fieldClassNames} px-3 disabled:bg-subtle`}
            />
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <LockIcon />
          Saved in {getCredentialStoreName()}, never sent to graphrt
        </span>
      </span>
    </label>
  )
}

/**
 * Screen 01 · Welcome. First-run onboarding shown before the app shell exists:
 * pick which AI powers agents (own API key today, graphrt credits later) and whether
 * agents keep running from the menu bar. Continue saves the key in the keychain (or the local Ollama address) plus the default
 * model, then opens the first "New agent" screen.
 */
export function WelcomePage() {
  const navigate = useNavigate()
  const [provider, setProvider] = useState<AiProvider>('OpenAI')
  const [apiKey, setApiKeyDraft] = useState('')
  const [keepRunningInMenuBar, setKeepRunningInMenuBar] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const canContinue = !isSaving && (provider === 'Ollama (local)' || apiKey.trim().length > 0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canContinue) return
    setIsSaving(true)
    setSaveErrorMessage(null)
    try {
      await saveModelSetup(provider, apiKey)
      navigate(routePaths.newAgent)
    } catch (saveError) {
      setSaveErrorMessage(`Could not save your AI setup: ${describeError(saveError)}`)
      setIsSaving(false)
    }
  }

  return (
    <div className="box-border flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-canvas px-6 py-12 text-[14px] text-ink">
      <div className="flex items-center gap-3">
        <LogoMark size={40} />
        <span className="text-[26px] font-bold tracking-[-0.5px]">graphrt</span>
      </div>

      <form onSubmit={handleSubmit} className="box-border flex w-full max-w-[600px] flex-col gap-7 rounded-[20px] border border-line bg-surface p-10">
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-brand-strong">Takes about a minute</span>
          <h1 className="m-0 text-[30px] font-semibold tracking-[-0.5px]">Agents that run on your computer</h1>
          <p className="m-0 text-[15px] leading-[1.6] text-body">Describe a job, review the steps, then let it run. Your files, sessions and keys stay on this machine</p>
        </div>

        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2.5 p-0 font-semibold">Which AI should your agents use?</legend>
          <CreditsOption />
          <ApiKeyOption provider={provider} apiKey={apiKey} onProviderChange={setProvider} onApiKeyChange={setApiKeyDraft} />
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={keepRunningInMenuBar}
            onChange={(event) => setKeepRunningInMenuBar(event.target.checked)}
            className="mt-0.5 size-[18px] accent-brand"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Keep agents running from the {getTrayAreaName()}</span>
            <span className="text-body">Scheduled agents still run after you close this window</span>
          </span>
        </label>

        {saveErrorMessage && (
          <p role="alert" className="m-0 leading-normal text-danger">
            {saveErrorMessage}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Link to={routePaths.home} className="font-medium">
            I have an account
          </Link>
          <button
            type="submit"
            disabled={!canContinue}
            className="h-11 cursor-pointer rounded-xl border-0 bg-ink px-[22px] text-[15px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
