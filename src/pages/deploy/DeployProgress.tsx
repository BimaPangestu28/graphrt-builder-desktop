import { useState } from 'react'
import type { DeployOutcome } from '@/api/deployTypes'
import { Badge, Button, Icon, LinkButton, StatusDot, joinClassNames } from '@/components/ui'
import { getCredentialStoreName } from '@/lib/platform'
import { agentPath, routePaths } from '@/routes'
import { DevelopersDetails } from './DeployDialog'
import { NewAccessKey } from './NewAccessKey'
import { currentDeployStep, deployProgressPercent, deployStepLabels, deployStepOrder, type StepStates } from './deployDisplay'
import { messages } from '@/i18n'

interface DeployProgressViewProps {
  stepStates: StepStates
  logLines: string[]
  /** One plain sentence when it failed; null while running. */
  errorMessage: string | null
  onCancel: () => void
  onRetry: () => void
  isCancelling: boolean
}

/** "Putting it online…": the bar, the four human steps, and the technical log under Details. */
export function DeployProgressView({ stepStates, logLines, errorMessage, onCancel, onRetry, isCancelling }: DeployProgressViewProps) {
  const percent = deployProgressPercent(stepStates)
  const currentStep = currentDeployStep(stepStates)
  return (
    <section aria-label={messages().deploy.puttingItOnline} className="flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">{errorMessage ? messages().deploy.itCouldNotGoOnline : messages().deploy.puttingItOnline2}</h2>
        {!errorMessage && <span className="text-body">{deployStepLabels[currentStep]}</span>}
      </div>
      {errorMessage ? (
        <p role="alert" className="m-0 rounded-[12px] border border-danger-line bg-danger-tint px-4 py-3 leading-normal text-danger-deep">
          {errorMessage}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label={messages().deploy.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-10 text-right text-[13px] font-semibold text-ink-2">{percent}%</span>
        </div>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {deployStepOrder.map((step) => {
          const status = stepStates[step]
          return (
            <li key={step} className="flex items-center gap-3">
              <span
                className={joinClassNames(
                  'flex size-6 items-center justify-center rounded-full',
                  status === 'done' ? 'bg-ok text-inverse' : status === 'failed' ? 'bg-danger text-inverse' : status === 'running' ? 'bg-brand-soft text-brand' : 'bg-chip text-muted',
                )}
              >
                {status === 'done' ? <Icon name="check" size={13} /> : status === 'failed' ? <Icon name="close" size={13} /> : <StatusDot tone={status === 'running' ? 'brand' : 'paused'} />}
              </span>
              <span className={joinClassNames(status ? 'font-medium text-ink' : 'text-muted')}>{deployStepLabels[step]}</span>
            </li>
          )
        })}
      </ol>
      <DevelopersDetails summary={messages().deploy.details}>
        <span className="text-[12px] text-muted">{messages().deploy.technicalLogForDevelopers}</span>
        <pre className="m-0 max-h-[240px] overflow-auto rounded-lg bg-subtle p-3 font-mono text-[12px] leading-[1.6] text-ink-2">{logLines.length > 0 ? logLines.join('\n') : messages().deploy.waitingForTheFirstMessage}</pre>
      </DevelopersDetails>
      <div className="flex gap-2">
        {errorMessage ? (
          <Button onClick={onRetry}>{messages().deploy.tryAgain}</Button>
        ) : (
          <Button variant="secondary" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? messages().deploy.stopping : messages().deploy.cancel}
          </Button>
        )}
      </div>
    </section>
  )
}

interface DeployDoneViewProps {
  agentId: string
  agentName: string
  outcome: DeployOutcome
}

/**
 * "<agent> is online": what happens now, and the connection details for developers: the key of a
 * first deploy (shown once; later deploys keep the saved one) and "Make a new key".
 */
export function DeployDoneView({ agentId, agentName, outcome }: DeployDoneViewProps) {
  const [isKeyShown, setIsKeyShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = outcome.view.deployment.url ?? ''
  // graphrt names the workflow after the agent file the desktop sends (`agent.yaml`).
  const runsEndpoint = `${url}/v1/workflows/${outcome.workflow ?? 'agent'}/runs`
  const curlExample = messages().deploy.curlXPostRunsendpointHAuthorization(runsEndpoint)
  return (
    <section aria-label={messages().deploy.itIsOnline} className="flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">{agentName} {messages().deploy.isOnline}</h2>
        <Badge tone="ok" className="w-fit">
          <StatusDot tone="ok" /> {messages().deploy.onlineWorking}
        </Badge>
        <span className="leading-normal text-body">{messages().deploy.itKeepsWorkingWhenYourComputer}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkButton to={`${routePaths.runs}?where=online`}>{messages().deploy.openRuns}</LinkButton>
        <LinkButton to={agentPath('builder', agentId)} variant="secondary">
          {messages().deploy.backToTheAgent}
        </LinkButton>
      </div>
      <DevelopersDetails summary={messages().deploy.connectionDetailsForDevelopers}>
        <span className="font-medium text-ink-2">{messages().deploy.webAddress}</span>
        <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]">{runsEndpoint}</code>
        <span className="font-medium text-ink-2">{messages().deploy.accessKey}</span>
        {outcome.apiKey ? (
          <>
            <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]">{isKeyShown ? outcome.apiKey : 'grk_••••••••••••••••'}</code>
            <span className="flex flex-wrap gap-2">
              {!isKeyShown && (
                <Button size="sm" variant="secondary" onClick={() => setIsKeyShown(true)}>
                  {messages().deploy.showAccessKeyOnce}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(curlExample)
                  setCopied(true)
                }}
              >
                {copied ? messages().deploy.copied : messages().deploy.copyExample}
              </Button>
            </span>
            <span className="text-[12px] text-muted">{messages().deploy.afterYouLeaveThisPageThe}{' '}{getCredentialStoreName()}{messages().deploy.forRuns}</span>
          </>
        ) : (
          <span>{outcome.view.hasApiKey ? messages().deploy.theSameKeyAsBeforeKept(getCredentialStoreName()) : messages().deploy.noKeyIsSavedOnThis}</span>
        )}
        <NewAccessKey agentId={agentId} />
      </DevelopersDetails>
    </section>
  )
}
