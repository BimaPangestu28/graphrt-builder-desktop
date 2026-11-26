import type { ReactNode } from 'react'
import type { LocalCliProvider, ProviderStatus } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Button } from '@/components/ui'
import { describeLocalCliUsageNote, localCliCommands, localCliProviders, localCliShortNames } from '@/lib/settings'
import type { WelcomeWizard } from './useWelcomeWizard'
import { choiceGridClassNames, WelcomeChoiceCard } from './WelcomeChoiceCard'
import { ApiKeyFields, FoundLine, ollamaDownloadUrl, ProblemLine, TechnicalDetails } from './WelcomeChoiceDetails'
import { StepHeader } from './WizardSteps'
import { accountTitle, brokenTools, checkApiKey, installedTools } from './welcomeWizard'
import { messages, useT } from '@/i18n'

function findLocalCli(statuses: readonly ProviderStatus[] | null, provider: LocalCliProvider) {
  return statuses?.find((status) => status.provider === provider)?.localCli ?? null
}

/** Plain sign-in state of a found tool; the Terminal command stays in the technical details. */
function describeSignIn(provider: LocalCliProvider, statuses: readonly ProviderStatus[] | null): ReactNode {
  const t = messages().welcome
  const signIn = findLocalCli(statuses, provider)?.signIn
  if (signIn === 'signed_in') return <FoundLine text={t.signedInReady} />
  if (signIn === 'signed_out') {
    return <ProblemLine text={t.notSignedInYet(localCliShortNames[provider])} showDot={false} />
  }
  return <span className="text-ink-2">{t.signInConfirmedLater}</span>
}

/** Step 3 for "an account I already have": pick which signed-in AI tool to use. */
function ExistingAccountSetup({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const { statuses } = wizard.detection
  const tools = installedTools(statuses)
  const notStartingTools = brokenTools(statuses)
  const selectedTool = wizard.answers.tool
  const selectedLocalCli = selectedTool ? findLocalCli(statuses, selectedTool) : null
  const missingTools = localCliProviders.filter((provider) => findLocalCli(statuses, provider)?.installed === false)
  return (
    <>
      <StepHeader
        title={tools.length > 1 ? t.whichAccountTitle : t.useAccountTitle}
        description={t.accountDescription}
      />
      <fieldset className={choiceGridClassNames(tools.length + notStartingTools.length)}>
        <legend className="sr-only">{t.accountLegend}</legend>
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
                <span>{t.through(localCliShortNames[provider])}</span>
                {describeSignIn(provider, statuses)}
              </>
            }
          />
        ))}
        {notStartingTools.map((provider) => (
          <WelcomeChoiceCard
            key={provider}
            groupName="welcome-tool"
            value={provider}
            selectedValue={selectedTool}
            onSelect={wizard.setTool}
            isUnavailable
            title={accountTitle(provider)}
            details={
              <>
                <span>{t.through(localCliShortNames[provider])}</span>
                <ProblemLine text={t.toolDoesNotStart} showDot={false} />
              </>
            }
          />
        ))}
      </fieldset>
      <p className="m-0 text-[13px] text-muted">{t.sharingHint}</p>
      <TechnicalDetails>
        {selectedTool && (
          <>
            <p className="m-0">{describeLocalCliUsageNote(selectedTool)}</p>
            {selectedLocalCli?.version && <p className="m-0 break-words">{t.version(selectedLocalCli.version)}</p>}
            {selectedLocalCli?.path && <p className="m-0 break-all">{t.location(selectedLocalCli.path)}</p>}
            {selectedLocalCli?.signIn === 'signed_out' && (
              <p className="m-0">
                {t.toSignInRun} <code>{localCliCommands[selectedTool]}</code> {t.inTerminal}
              </p>
            )}
          </>
        )}
        {notStartingTools.map((provider) => {
          const localCli = findLocalCli(statuses, provider)
          return (
            <p key={provider} className="m-0 break-words">
              {localCliShortNames[provider]}: {localCli?.problem}
              {localCli?.path && <span className="break-all"> ({localCli.path})</span>}
            </p>
          )
        })}
        {missingTools.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-ink-2">{t.otherTools}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {missingTools.map((provider) => {
                const localCli = findLocalCli(statuses, provider)
                return (
                  <li key={provider} className="flex flex-wrap gap-x-1.5">
                    <span>{t.notInstalledDot(localCliShortNames[provider])}</span>
                    {localCli && <InstallPageLink provider={provider} url={localCli.installUrl} label={t.howToInstall(localCliShortNames[provider])} />}
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
  const t = useT().welcome
  const { apiKeyProvider, apiKey } = wizard.answers
  return (
    <>
      <StepHeader title={t.companyKeyStepTitle} description={t.companyKeyStepDescription} />
      <ApiKeyFields
        provider={apiKeyProvider}
        apiKey={apiKey}
        check={checkApiKey(apiKeyProvider, apiKey)}
        onProviderChange={wizard.setApiKeyProvider}
        onApiKeyChange={wizard.setApiKey}
      />
      <TechnicalDetails summary={t.whereCreateKey}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          {t.keyPlaces.map((place) => (
            <li key={place}>{place}</li>
          ))}
        </ul>
        <p className="m-0">{t.smallModelNote}</p>
      </TechnicalDetails>
    </>
  )
}

/** Step 3 for "free, private AI": whether Ollama runs, else how to get it, with "Check again". */
function PrivateModelSetup({ wizard }: { wizard: WelcomeWizard }) {
  const t = useT().welcome
  const isRunning = wizard.detection.isOllamaRunning
  return (
    <>
      <StepHeader title={t.privateModelTitle} description={t.privateStepDescription} />
      {isRunning ? (
        <div className="rounded-[14px] border border-line-strong p-4 text-[15px]">
          <FoundLine text={t.ollamaReady} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] border border-line-strong p-4">
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-normal">
            <li>
              <InstallPageLink provider="ollama" url={ollamaDownloadUrl} label={t.downloadOllama} />
              {t.freeAndInstall}
            </li>
            <li>{t.openOllamaComeBack}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={wizard.checkOllamaAgain} disabled={wizard.isCheckingOllama}>
              {wizard.isCheckingOllama ? t.checking : t.checkAgain}
            </Button>
            <span className="text-[13px] text-muted">{isRunning === null ? t.lookingForOllama : t.ollamaNotRunning}</span>
          </div>
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">{t.continueWithoutOllama}</p>
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
