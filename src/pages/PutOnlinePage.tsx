import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cancelDeploy, checkDeployCompatibility, deployAgent, getAgentDeployment, getDeployReview, listDeployAccounts, listOwnServers, subscribeToDeployEvents } from '@/api/deploy'
import type { CompatibilityReport, DeployAccount, DeployOutcome, DeployProvider, DeployReview } from '@/api/deployTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Button, Icon, joinClassNames } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { agentPath, sampleAgentId } from '@/routes'
import { CompatibilityChecklist } from './deploy/CompatibilityChecklist'
import { applyDeployEvent, plainErrorMessage, type StepStates } from './deploy/deployDisplay'
import { DeployDoneView, DeployProgressView } from './deploy/DeployProgress'
import { ProviderList } from './deploy/ProviderList'
import { ReviewStep, type DeployChoice } from './deploy/ReviewStep'
import { WhereStep, type RunPlace } from './deploy/WhereStep'
import { messages } from '@/i18n'
import { withLocalizedLabels } from '@/i18n/localized'

/** The wizard's screens; the stepper shows Where (where + check), Provider and Review. */
export type PutOnlineScreen = 'where' | 'check' | 'provider' | 'review' | 'deploying' | 'done'

const stepperSteps = withLocalizedLabels(
  [
    { key: 'where', screens: ['where', 'check'] },
    { key: 'provider', screens: ['provider'] },
    { key: 'review', screens: ['review'] },
  ] as const,
  (step) => messages().deploy.stepper[step.key],
)

/** "1 Where · 2 Provider · 3 Review" in one row. */
function WizardStepper({ screen }: { screen: PutOnlineScreen }) {
  const activeIndex = stepperSteps.findIndex((step) => (step.screens as readonly string[]).includes(screen))
  return (
    <ol aria-label={messages().deploy.steps} className="m-0 flex list-none flex-nowrap items-center gap-2 overflow-x-auto p-0">
      {stepperSteps.map((step, index) => {
        const isDone = index < activeIndex
        const isActive = index === activeIndex
        return (
          <li key={step.label} aria-current={isActive ? 'step' : undefined} className="flex shrink-0 items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="h-px w-8 bg-line-strong" />}
            <span
              className={joinClassNames(
                'flex size-6 items-center justify-center rounded-full text-[12px] font-semibold',
                isActive ? 'bg-ink text-inverse' : isDone ? 'bg-ok text-inverse' : 'bg-chip text-muted',
              )}
            >
              {isDone ? <Icon name="check" size={12} /> : index + 1}
            </span>
            <span className={joinClassNames('text-[13px]', isActive ? 'font-semibold text-ink' : 'text-body')}>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Deploy progress, cancel and the outcome for one agent. */
function useDeployRun(agentId: string) {
  const [stepStates, setStepStates] = useState<StepStates>({})
  const [logLines, setLogLines] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DeployOutcome | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let isActive = true
    void subscribeToDeployEvents((event) => {
      if (event.agentId !== agentId) return
      if (event.kind === 'log') setLogLines((lines) => [...lines.slice(-400), event.line])
      else setStepStates((states) => applyDeployEvent(states, event))
    }).then((stop) => {
      if (isActive) unsubscribe = stop
      else stop()
    })
    return () => {
      isActive = false
      unsubscribe?.()
    }
  }, [agentId])

  const start = useCallback(
    async (provider: DeployProvider, { mode, area, image, features }: DeployChoice) => {
      setStepStates({})
      setLogLines([])
      setErrorMessage(null)
      setOutcome(null)
      setIsCancelling(false)
      try {
        const result = await deployAgent(agentId, { provider, mode, area, image, features })
        setOutcome(result)
        return true
      } catch (error) {
        setErrorMessage(plainErrorMessage(error))
        return false
      }
    },
    [agentId],
  )

  const cancel = useCallback(async () => {
    setIsCancelling(true)
    await cancelDeploy(agentId)
  }, [agentId])

  return { stepStates, logLines, errorMessage, outcome, isCancelling, start, cancel }
}

/**
 * Screens 57–64 · Put it online for the agent in `:agentId`: Where (This computer / Online / My
 * own server), the compatibility checklist, Provider (Connect opens a popup), Review, then
 * progress and the done state. `?screen=review` opens Review directly ("Update with latest
 * changes"), with the online copy's provider and settings.
 */
export function PutOnlinePage() {
  const agentId = useParams().agentId ?? sampleAgentId
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const agentState = useAgent(agentId)
  const agent = agentState.data
  const [screen, setScreen] = useState<PutOnlineScreen>(searchParams.get('screen') === 'review' ? 'review' : 'where')
  const [place, setPlace] = useState<RunPlace>('online')
  const [report, setReport] = useState<CompatibilityReport | null>(null)
  const [accounts, setAccounts] = useState<DeployAccount[] | null>(null)
  const [provider, setProvider] = useState<DeployProvider>('fly')
  const [review, setReview] = useState<DeployReview | null>(null)
  const [isUpdate, setIsUpdate] = useState(false)
  const [serverCount, setServerCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const deployRun = useDeployRun(agentId)
  const lastChoice = useRef<DeployChoice | null>(null)

  const loadAccounts = useCallback(async () => setAccounts(await listDeployAccounts()), [])
  const loadReport = useCallback(async () => setReport(await checkDeployCompatibility(agentId)), [agentId])
  const loadReview = useCallback(async (chosen: DeployProvider) => setReview(await getDeployReview(agentId, chosen)), [agentId])

  useEffect(() => {
    void listOwnServers().then((servers) => setServerCount(servers.length)).catch(() => setServerCount(0))
    void loadAccounts().catch((error) => setLoadError(plainErrorMessage(error)))
    void getAgentDeployment(agentId).then((view) => {
      if (!view) return
      setIsUpdate(view.deployment.status !== 'failed')
      setProvider(view.deployment.provider)
      if (searchParams.get('screen') === 'review') void loadReview(view.deployment.provider)
    })
  }, [agentId, loadAccounts, loadReview, searchParams])

  async function goTo(nextScreen: PutOnlineScreen) {
    setLoadError(null)
    try {
      if (nextScreen === 'check') await loadReport()
      if (nextScreen === 'review') await loadReview(provider)
      setScreen(nextScreen)
    } catch (error) {
      setLoadError(plainErrorMessage(error))
    }
  }

  function leaveWhere() {
    if (place === 'local') navigate(agentPath('builder', agentId))
    else if (place === 'own_server') navigate(agentPath('ownServer', agentId))
    else void goTo('check')
  }

  async function confirm(choice: DeployChoice) {
    lastChoice.current = choice
    setScreen('deploying')
    const succeeded = await deployRun.start(provider, choice)
    if (succeeded) setScreen('done')
  }

  const agentName = agent?.name ?? messages().lib.thisAgent
  const selectedAccount = accounts?.find((account) => account.provider === provider)

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }}>
      <PageFrame ariaLabel={messages().deploy.putItOnline} className="gap-5">
        <PageTitleBlock title={messages().deploy.putItOnline} subtitle={agentName} />
        {screen !== 'deploying' && screen !== 'done' && <WizardStepper screen={screen} />}
        {loadError && (
          <p role="alert" className="m-0 rounded-[12px] border border-danger-line bg-danger-tint px-4 py-3 text-danger-deep">
            {loadError}
          </p>
        )}
        {screen === 'where' && (
          <WhereStep agentName={agentName} selectedPlace={place} onSelect={setPlace} connectedServerCount={serverCount} onNext={leaveWhere} onCancel={() => navigate(agentPath('builder', agentId))} />
        )}
        {screen === 'check' && report && (
          <CompatibilityChecklist
            agentId={agentId}
            agentName={agentName}
            report={report}
            onRecheck={async () => {
              await Promise.all([loadReport(), agentState.reload()])
            }}
            onContinue={() => setScreen('provider')}
            onKeepLocal={() => navigate(agentPath('builder', agentId))}
          />
        )}
        {screen === 'provider' && (
          <section aria-label={messages().deploy.whereOnline} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">{messages().deploy.whereOnline}</h2>
              <span className="text-body">{messages().deploy.yourAgentRunsInYourOwn}</span>
            </div>
            {accounts ? <ProviderList accounts={accounts} selectedProvider={provider} onSelect={setProvider} onAccountsChanged={() => void loadAccounts()} /> : <p className="m-0 text-muted">{messages().deploy.loadingProviders}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void goTo('review')} disabled={!selectedAccount?.connected}>
                {messages().deploy.next}
              </Button>
              <Button variant="ghost" onClick={() => setScreen('check')}>
                {messages().deploy.back}
              </Button>
              {!selectedAccount?.connected && <span className="text-[13px] text-muted">{messages().deploy.connect}{' '}{selectedAccount?.displayName ?? messages().deploy.aProvider} {messages().deploy.toContinue}</span>}
            </div>
          </section>
        )}
        {screen === 'review' &&
          (review ? (
            <ReviewStep
              agentName={agentName}
              review={review}
              isUpdate={isUpdate}
              onCliChanged={(cli) => setReview({ ...review, cli })}
              onBack={() => (isUpdate && searchParams.get('screen') === 'review' ? navigate(agentPath('builder', agentId)) : setScreen('provider'))}
              onConfirm={(choice) => void confirm(choice)}
            />
          ) : (
            <p className="m-0 text-muted">{messages().deploy.loadingTheReview}</p>
          ))}
        {screen === 'deploying' && (
          <DeployProgressView
            stepStates={deployRun.stepStates}
            logLines={deployRun.logLines}
            errorMessage={deployRun.errorMessage}
            isCancelling={deployRun.isCancelling}
            onCancel={() => void deployRun.cancel()}
            onRetry={() => (lastChoice.current ? void confirm(lastChoice.current) : setScreen('review'))}
          />
        )}
        {screen === 'done' && deployRun.outcome && <DeployDoneView agentId={agentId} agentName={agentName} outcome={deployRun.outcome} />}
      </PageFrame>
    </AppShell>
  )
}
