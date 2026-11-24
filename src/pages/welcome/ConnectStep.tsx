import type { ReactNode } from 'react'
import type { LocalCliProvider, ProviderStatus } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Button, StatusDot } from '@/components/ui'
import { describeLocalCliUsageNote, localCliCommands, localCliProviders, localCliShortNames } from '@/lib/settings'
import type { WelcomeWizard } from './useWelcomeWizard'
import { WelcomeChoiceCard } from './WelcomeChoiceCard'
import { ApiKeyFields, FoundLine, ollamaDownloadUrl, TechnicalDetails } from './WelcomeChoiceDetails'
import { StepHeader } from './WizardSteps'
import { accountTitle, checkApiKey, installedTools } from './welcomeWizard'

function findLocalCli(statuses: readonly ProviderStatus[] | null, provider: LocalCliProvider) {
  return statuses?.find((status) => status.provider === provider)?.localCli ?? null
}

/** Plain sign-in state of a found tool; the Terminal command stays in the technical details. */
function describeSignIn(provider: LocalCliProvider, statuses: readonly ProviderStatus[] | null): ReactNode {
  const signIn = findLocalCli(statuses, provider)?.signIn
  if (signIn === 'signed_in') return <FoundLine text="Signed in and ready" />
  if (signIn === 'signed_out') {
    return (
      <span className="flex items-center gap-1.5 text-amber-strong">
        <StatusDot tone="amber" />
        Not signed in yet. Open {localCliShortNames[provider]} once and sign in, then come back
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-ink-2">
      <StatusDot tone="paused" />
      Found. graphrt confirms the sign-in when your first agent runs
    </span>
  )
}

/** Step 3 for "an account I already have": pick which signed-in AI tool to use. */
function ExistingAccountSetup({ wizard }: { wizard: WelcomeWizard }) {
  const { statuses } = wizard.detection
  const tools = installedTools(statuses)
  const selectedTool = wizard.answers.tool
  const selectedLocalCli = selectedTool ? findLocalCli(statuses, selectedTool) : null
  const missingTools = localCliProviders.filter((provider) => findLocalCli(statuses, provider)?.installed === false)
  return (
    <>
      <StepHeader
        title={tools.length > 1 ? 'Which AI account should graphrt use?' : 'Use the AI account on this computer'}
        description="graphrt works through the AI app you are already signed in to. Usage counts against that account’s plan and limits."
      />
      <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
        <legend className="sr-only">AI account</legend>
        {tools.map((provider) => (
          <WelcomeChoiceCard
            key={provider}
            groupName="welcome-tool"
            value={provider}
            selectedValue={selectedTool}
            onSelect={wizard.setTool}
            title={accountTitle(provider)}
            details={
              <>
                <span>Through {localCliShortNames[provider]}</span>
                {describeSignIn(provider, statuses)}
              </>
            }
          />
        ))}
      </fieldset>
      <p className="m-0 text-[13px] text-muted">Sharing agents with other people? A company API key is the better fit; go Back to pick it.</p>
      <TechnicalDetails>
        {selectedTool && (
          <>
            <p className="m-0">{describeLocalCliUsageNote(selectedTool)}</p>
            {selectedLocalCli?.version && <p className="m-0 break-words">Version: {selectedLocalCli.version}</p>}
            {selectedLocalCli?.path && <p className="m-0 break-all">Location: {selectedLocalCli.path}</p>}
            {selectedLocalCli?.signIn === 'signed_out' && (
              <p className="m-0">
                To sign in, run <code>{localCliCommands[selectedTool]}</code> in Terminal.
              </p>
            )}
          </>
        )}
        {missingTools.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-ink-2">Other AI tools graphrt can use</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {missingTools.map((provider) => {
                const localCli = findLocalCli(statuses, provider)
                return (
                  <li key={provider} className="flex flex-wrap gap-x-1.5">
                    <span>{localCliShortNames[provider]} · not installed ·</span>
                    {localCli && <InstallPageLink provider={provider} url={localCli.installUrl} label={`How to install ${localCliShortNames[provider]}`} />}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </TechnicalDetails>
    </>
  )
}

/** Step 3 for "my company's API key": provider, key and a local check of the key. */
function CompanyKeySetup({ wizard }: { wizard: WelcomeWizard }) {
  const { apiKeyProvider, apiKey } = wizard.answers
  return (
    <>
      <StepHeader title="Add your company’s API key" description="Not sure where to find it? Ask whoever manages AI tools at your company. The key stays on this computer." />
      <ApiKeyFields
        provider={apiKeyProvider}
        apiKey={apiKey}
        check={checkApiKey(apiKeyProvider, apiKey)}
        onProviderChange={wizard.setApiKeyProvider}
        onApiKeyChange={wizard.setApiKey}
      />
      <TechnicalDetails summary="Where do I create a key?">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          <li>OpenAI: platform.openai.com › API keys</li>
          <li>Anthropic: console.anthropic.com › API keys</li>
          <li>Google Gemini: aistudio.google.com › Get API key</li>
          <li>DeepSeek: platform.deepseek.com › API keys</li>
        </ul>
        <p className="m-0">graphrt picks a small, low-cost model to start; you can choose another in Connections.</p>
      </TechnicalDetails>
    </>
  )
}

/** Step 3 for "free, private AI": whether Ollama runs, else how to get it, with "Check again". */
function PrivateModelSetup({ wizard }: { wizard: WelcomeWizard }) {
  const isRunning = wizard.detection.isOllamaRunning
  return (
    <>
      <StepHeader title="Free, private AI on this computer" description="graphrt uses Ollama, a free app that runs AI on this computer. Nothing you type leaves it." />
      {isRunning ? (
        <div className="rounded-[14px] border border-line-strong p-4 text-[15px]">
          <FoundLine text="Ollama is running. You are ready to go" />
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] border border-line-strong p-4">
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-normal">
            <li>
              <InstallPageLink provider="ollama" url={ollamaDownloadUrl} label="Download Ollama" /> (free) and install it
            </li>
            <li>Open Ollama, then come back here</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={wizard.checkOllamaAgain} disabled={wizard.isCheckingOllama}>
              {wizard.isCheckingOllama ? 'Checking…' : 'Check again'}
            </Button>
            <span className="text-[13px] text-muted">{isRunning === null ? 'Looking for Ollama…' : 'Ollama is not running yet'}</span>
          </div>
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">You can also continue now and finish installing Ollama later.</p>
    </>
  )
}

/** Step 3: only the setup for the approach picked on step 2. */
export function ConnectStep({ wizard }: { wizard: WelcomeWizard }) {
  switch (wizard.answers.approach) {
    case 'existing-account':
      return <ExistingAccountSetup wizard={wizard} />
    case 'company-key':
      return <CompanyKeySetup wizard={wizard} />
    case 'private-model':
      return <PrivateModelSetup wizard={wizard} />
    default:
      return null
  }
}
