import { useState } from 'react'
import type { DeployOutcome } from '@/api/deployTypes'
import { Badge, Button, Icon, LinkButton, StatusDot, joinClassNames } from '@/components/ui'
import { getCredentialStoreName } from '@/lib/platform'
import { agentPath, routePaths } from '@/routes'
import { DevelopersDetails } from './DeployDialog'
import { currentDeployStep, deployProgressPercent, deployStepLabels, deployStepOrder, type StepStates } from './deployDisplay'

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
    <section aria-label="Putting it online" className="flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">{errorMessage ? 'It could not go online' : 'Putting it online…'}</h2>
        {!errorMessage && <span className="text-body">{deployStepLabels[currentStep]}</span>}
      </div>
      {errorMessage ? (
        <p role="alert" className="m-0 rounded-[12px] border border-danger-line bg-danger-tint px-4 py-3 leading-normal text-danger-deep">
          {errorMessage}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
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
                  status === 'done' ? 'bg-ok text-white' : status === 'failed' ? 'bg-danger text-white' : status === 'running' ? 'bg-brand-soft text-brand' : 'bg-chip text-muted',
                )}
              >
                {status === 'done' ? <Icon name="check" size={13} /> : status === 'failed' ? <Icon name="close" size={13} /> : <StatusDot tone={status === 'running' ? 'brand' : 'paused'} />}
              </span>
              <span className={joinClassNames(status ? 'font-medium text-ink' : 'text-muted')}>{deployStepLabels[step]}</span>
            </li>
          )
        })}
      </ol>
      <DevelopersDetails summary="Details">
        <span className="text-[12px] text-muted">Technical log for developers</span>
        <pre className="m-0 max-h-[240px] overflow-auto rounded-lg bg-subtle p-3 font-mono text-[12px] leading-[1.6] text-ink-2">{logLines.length > 0 ? logLines.join('\n') : 'Waiting for the first message…'}</pre>
      </DevelopersDetails>
      <div className="flex gap-2">
        {errorMessage ? (
          <Button onClick={onRetry}>Try again</Button>
        ) : (
          <Button variant="secondary" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? 'Stopping…' : 'Cancel'}
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

/** "<agent> is online": what happens now, and the connection details for developers (key shown once). */
export function DeployDoneView({ agentId, agentName, outcome }: DeployDoneViewProps) {
  const [isKeyShown, setIsKeyShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = outcome.view.deployment.url ?? ''
  const runsEndpoint = `${url}/v1/workflows/${outcome.view.deployment.deploymentName}/runs`
  const curlExample = `curl -X POST ${runsEndpoint} \\\n  -H "Authorization: Bearer $GRAPHRT_API_KEY" \\\n  -H "Content-Type: application/json" -d '{"inputs":{}}'`
  return (
    <section aria-label="It is online" className="flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">{agentName} is online</h2>
        <Badge tone="ok" className="w-fit">
          <StatusDot tone="ok" /> Online · working
        </Badge>
        <span className="leading-normal text-body">It keeps working when your computer is off. You'll see what it does in Runs.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkButton to={`${routePaths.runs}?where=online`}>Open runs</LinkButton>
        <LinkButton to={agentPath('builder', agentId)} variant="secondary">
          Back to the agent
        </LinkButton>
      </div>
      <DevelopersDetails summary="Connection details for developers">
        <span className="font-medium text-ink-2">Web address</span>
        <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]">{runsEndpoint}</code>
        <span className="font-medium text-ink-2">Access key</span>
        {outcome.apiKey ? (
          <>
            <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]">{isKeyShown ? outcome.apiKey : 'grt_••••••••••••••••'}</code>
            <span className="flex flex-wrap gap-2">
              {!isKeyShown && (
                <Button size="sm" variant="secondary" onClick={() => setIsKeyShown(true)}>
                  Show access key once
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
                {copied ? 'Copied' : 'Copy example'}
              </Button>
            </span>
            <span className="text-[12px] text-muted">After you leave this page the key is only kept in {getCredentialStoreName()}, for Runs.</span>
          </>
        ) : (
          <span>Kept in {getCredentialStoreName()}.</span>
        )}
      </DevelopersDetails>
    </section>
  )
}
