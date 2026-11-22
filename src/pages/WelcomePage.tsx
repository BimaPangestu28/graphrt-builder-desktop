import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAvailableModels, listProviderStatuses } from '@/api/credentials'
import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { LocalCliProvider, ProviderStatus, WelcomeChoice } from '@/api/types'
import { Badge, LogoMark } from '@/components/ui'
import { localCliShortNames, primaryLocalCliProviders } from '@/lib/settings'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { getTrayAreaName } from '@/lib/platform'
import { ApiKeyFields, LocalCliChoiceDetails, OllamaChoiceDetails } from './welcome/WelcomeChoiceDetails'
import { MoreLocalCliTools } from './welcome/MoreLocalCliTools'
import { WelcomeChoiceCard } from './welcome/WelcomeChoiceCard'
import { pathAfterWelcome, saveWelcomeSetup, type ApiKeyProvider } from './welcome/welcomeSetup'

/** True once Ollama answered with a model list; null while asking. */
function isOllamaRunning(catalog: ProviderModels[] | null, isLoading: boolean): boolean | null {
  if (isLoading && !catalog) return null
  const ollamaList = catalog?.find((list) => list.provider === 'ollama')
  return Boolean(ollamaList && !ollamaList.error)
}

function isLocalCliInstalled(statuses: ProviderStatus[] | null, provider: LocalCliProvider): boolean {
  return statuses?.find((status) => status.provider === provider)?.localCli?.installed ?? false
}

/** Hook for the Welcome detection: provider statuses (local CLIs) and whether Ollama runs. */
function useWelcomeDetection() {
  const statusesState = useAsyncData(() => listProviderStatuses(), [])
  const catalogState = useAsyncData(() => listAvailableModels(), [])
  return {
    statuses: statusesState.data,
    isOllamaRunning: isOllamaRunning(catalogState.data, catalogState.isLoading),
  }
}

/** The Experimental badge of the local CLI choices. */
function ExperimentalBadge() {
  return (
    <Badge tone="amber" className="px-2 py-0 text-[11px]">
      Experimental
    </Badge>
  )
}

/** The "Keep agents running from the menu bar" checkbox. */
function KeepRunningCheckbox({ isChecked, onChange }: { isChecked: boolean; onChange: (isChecked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={isChecked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 size-[18px] accent-brand" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Keep agents running from the {getTrayAreaName()}</span>
        <span className="text-body">Scheduled agents still run after you close this window</span>
      </span>
    </label>
  )
}

/** Hook for the Welcome form: the choice, API key fields, saving and where to go next. */
function useWelcomeForm() {
  const navigate = useNavigate()
  const [choice, setChoice] = useState<WelcomeChoice | null>(null)
  const [apiKeyProvider, setApiKeyProvider] = useState<ApiKeyProvider>('openai')
  const [apiKey, setApiKeyDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const isChoiceComplete = choice !== null && (choice !== 'api-key' || apiKey.trim().length > 0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choice || !isChoiceComplete || isSaving) return
    setIsSaving(true)
    setSaveErrorMessage(null)
    try {
      await saveWelcomeSetup({ choice, apiKeyProvider, apiKey })
      navigate(pathAfterWelcome(choice))
    } catch (saveError) {
      setSaveErrorMessage(`Could not save your choice: ${describeError(saveError)}`)
      setIsSaving(false)
    }
  }

  return { choice, setChoice, apiKeyProvider, setApiKeyProvider, apiKey, setApiKeyDraft, isSaving, saveErrorMessage, canContinue: isChoiceComplete && !isSaving, submit }
}

/**
 * Screen 01 · Welcome, the first launch: "How should graphrt think?". No key is needed to
 * start: the user can use Claude Code or Codex already signed in on this computer
 * (Experimental, detected automatically; Gemini CLI, Cursor CLI, GitHub Copilot CLI,
 * OpenCode and Qwen Code under "More AI tools on this computer"), a local model with Ollama, an API key, or skip
 * and explore first. Continue saves that setup and remembers the choice (so `/` stops
 * showing Welcome), then opens the New agent screen, or Home after Skip.
 */
export function WelcomePage() {
  const form = useWelcomeForm()
  const detection = useWelcomeDetection()
  const [keepRunningInMenuBar, setKeepRunningInMenuBar] = useState(true)
  const choiceCardProps = { selectedChoice: form.choice, onSelect: form.setChoice }

  return (
    <div className="box-border flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-canvas px-4 py-12 text-[14px] text-ink sm:px-6">
      <div className="flex items-center gap-3">
        <LogoMark size={40} />
        <span className="text-[26px] font-bold tracking-[-0.5px]">graphrt</span>
      </div>

      <form onSubmit={form.submit} className="box-border flex w-full max-w-[640px] flex-col gap-7 rounded-[20px] border border-line bg-surface p-6 sm:p-10">
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-brand-strong">Agents that run on your computer</span>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px] sm:text-[30px]">How should graphrt think?</h1>
          <p className="m-0 text-[15px] leading-[1.6] text-body">No API key needed to start. You can change this any time in Connections</p>
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
          <legend className="sr-only">How graphrt thinks</legend>
          <span aria-hidden="true" className="text-[12px] font-semibold text-muted">
            Already on this computer
          </span>
          {primaryLocalCliProviders.map((provider) => (
            <WelcomeChoiceCard
              key={provider}
              {...choiceCardProps}
              value={provider}
              title={`Use ${localCliShortNames[provider]} on this computer`}
              badges={<ExperimentalBadge />}
              isUnavailable={!isLocalCliInstalled(detection.statuses, provider)}
              details={<LocalCliChoiceDetails provider={provider} status={detection.statuses?.find((status) => status.provider === provider)} />}
            />
          ))}
          <MoreLocalCliTools statuses={detection.statuses} selectedChoice={form.choice} onSelect={form.setChoice} />
          <WelcomeChoiceCard {...choiceCardProps} value="ollama" title="Local model with Ollama" details={<OllamaChoiceDetails isRunning={detection.isOllamaRunning} />} />
          <span aria-hidden="true" className="mt-2 text-[12px] font-semibold text-muted">
            Or bring your own key
          </span>
          <WelcomeChoiceCard
            {...choiceCardProps}
            value="api-key"
            title="Add an API key"
            details={<span>OpenAI, Anthropic, Gemini or DeepSeek. Best for agents you share with others</span>}
            expandedContent={
              <ApiKeyFields provider={form.apiKeyProvider} apiKey={form.apiKey} onProviderChange={form.setApiKeyProvider} onApiKeyChange={form.setApiKeyDraft} />
            }
          />
          <WelcomeChoiceCard
            {...choiceCardProps}
            value="skip"
            isQuiet
            title="Skip for now — explore first"
            details={<span>Browse the app and templates without connecting anything. graphrt asks for a model when you build your first agent</span>}
          />
        </fieldset>

        <KeepRunningCheckbox isChecked={keepRunningInMenuBar} onChange={setKeepRunningInMenuBar} />

        {form.saveErrorMessage && (
          <p role="alert" className="m-0 leading-normal text-danger">
            {form.saveErrorMessage}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!form.canContinue}
            className="h-11 cursor-pointer rounded-xl border-0 bg-ink px-[22px] text-[15px] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.isSaving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
