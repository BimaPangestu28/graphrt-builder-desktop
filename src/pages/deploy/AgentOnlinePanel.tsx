import { useEffect, useId, useState } from 'react'
import { listDeployedVersions, manageAgentDeployment } from '@/api/deploy'
import type { DeployedVersion, DeploymentView, ManageAction } from '@/api/deployTypes'
import { Badge, Button, LinkButton, StatusDot } from '@/components/ui'
import { agentPath } from '@/routes'
import { DevelopersDetails } from './DeployDialog'
import { NewAccessKey } from './NewAccessKey'
import { OnlineFeaturesPanel } from './OnlineFeaturesPanel'
import { deployModeLabels, describeDeploymentStatus, describeTimeAgo, plainErrorMessage, serverAreaLabels } from './deployDisplay'
import { messages } from '@/i18n'

/** "On this computer" or "Online · working / paused / needs attention" under the agent's name. */
export function RunPlaceBadge({ view }: { view: DeploymentView | null }) {
  if (!view || view.deployment.status === 'failed') {
    return <Badge>{messages().deploy.onThisComputer}</Badge>
  }
  const display = describeDeploymentStatus(view.deployment.status)
  return (
    <Badge tone={display.tone}>
      <StatusDot tone={display.dot} />
      {messages().deploy.online}{' '}{display.label}
    </Badge>
  )
}

function TakeOfflineConfirmation({ agentName, providerName, onConfirm, onCancel, isBusy }: { agentName: string; providerName: string; onConfirm: () => void; onCancel: () => void; isBusy: boolean }) {
  const [typedName, setTypedName] = useState('')
  const inputId = useId()
  return (
    <div role="alertdialog" aria-label={messages().deploy.takeOffline} className="flex flex-col gap-3 rounded-xl border border-danger-line bg-danger-tint p-4">
      <span className="font-semibold text-danger-deep">{messages().deploy.take}{agentName}{messages().deploy.offline}</span>
      <span className="text-[13px] leading-normal text-body">
        {messages().deploy.thisRemovesTheOnlineCopyIts}{' '}{providerName} {messages().deploy.accountItKeepsWorkingOnThis}
      </span>
      <label htmlFor={inputId} className="text-[13px] text-ink-2">
        {messages().deploy.typeTheAgentsNameToConfirm}
      </label>
      <input id={inputId} value={typedName} onChange={(event) => setTypedName(event.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-[14px]" />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={isBusy || typedName.trim() !== agentName.trim()} className="bg-danger !text-inverse hover:bg-danger-deep">
          {isBusy ? messages().deploy.takingOffline : messages().deploy.takeOffline2}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isBusy}>
          {messages().deploy.keepItOnline}
        </Button>
      </div>
    </div>
  )
}

function DeployHistory({ versions, onRollback, isBusy }: { versions: DeployedVersion[]; onRollback: (label: string) => void; isBusy: boolean }) {
  if (versions.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[14px] font-semibold">{messages().deploy.history}</h3>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {versions.map((version, index) => (
          <li key={version.label} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
            <span className="flex flex-col">
              <span className="font-medium">{version.isCurrent ? messages().deploy.onlineNow : index === versions.length - 1 ? messages().deploy.firstTimeOnline : messages().deploy.earlierVersion}</span>
              <span className="text-[13px] text-body">
                {new Date(version.deployedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {version.changeSummary && ` · “${version.changeSummary}”`}
              </span>
            </span>
            {version.isCurrent ? (
              <Badge tone="ok">{messages().deploy.current}</Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => onRollback(version.label)} disabled={isBusy}>
                {messages().deploy.goBackToThis}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

interface AgentOnlinePanelProps {
  agentId: string
  agentName: string
  view: DeploymentView
  onViewChange: (view: DeploymentView | null) => void
}

/**
 * The deployed state in the builder: where it is online and how, Update with latest changes
 * (when the agent changed since), Pause / Resume, Take offline (typed confirmation) and History
 * with "Go back to this".
 */
export function AgentOnlinePanel({ agentId, agentName, view, onViewChange }: AgentOnlinePanelProps) {
  const [versions, setVersions] = useState<DeployedVersion[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isConfirmingOffline, setIsConfirmingOffline] = useState(false)
  const { deployment } = view
  const label = deployment.deployedVersionLabel

  useEffect(() => {
    void listDeployedVersions(agentId).then(setVersions).catch(() => setVersions([]))
  }, [agentId, label])

  async function run(action: ManageAction, name: string) {
    setBusyAction(name)
    setErrorMessage(null)
    try {
      const next = await manageAgentDeployment(agentId, action)
      onViewChange(next)
      if (action.action === 'remove') setIsConfirmingOffline(false)
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  if (deployment.status === 'failed') {
    return (
      <section aria-label={messages().deploy.online2} className="flex flex-col gap-2 rounded-[14px] border border-danger-line bg-danger-tint p-4">
        <span className="font-semibold text-danger-deep">{messages().deploy.itDidntGoOnline}</span>
        <span className="text-[13px] text-body">{deployment.statusMessage ?? messages().deploy.theLastTryFailed}</span>
        <div className="flex flex-wrap gap-2">
          <LinkButton to={agentPath('putOnline', agentId)} size="sm" className="w-fit">
            {messages().deploy.tryAgain}
          </LinkButton>
          {/* A failed first deploy can leave an app behind on the provider (e.g. after its key was stored). */}
          <Button size="sm" variant="secondary" onClick={() => void run({ action: 'remove' }, 'remove')} disabled={busyAction !== null}>
            {busyAction === 'remove' ? messages().deploy.removing : messages().deploy.removeWhatWasCreatedOnProvidername(view.providerName)}
          </Button>
        </div>
        {errorMessage && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {errorMessage}
          </p>
        )}
      </section>
    )
  }

  const isPaused = deployment.status === 'paused'
  const display = describeDeploymentStatus(deployment.status)
  const details = [`Last update: ${describeTimeAgo(deployment.updatedAt)}`, deployModeLabels[deployment.mode].title, view.area ? serverAreaLabels[view.area] : null].filter(Boolean).join(' · ')
  const updateLink = (
    <LinkButton to={agentPath('putOnline', agentId, { screen: 'review' })} size="sm">
      {messages().deploy.updateWithLatestChanges}
    </LinkButton>
  )

  return (
    <section aria-label={messages().deploy.online2} className="flex flex-col gap-4">
      {view.hasChanges && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-line bg-amber-tint px-4 py-3">
          <span className="font-medium text-amber-deep">{messages().deploy.youChangedThisAgentUpdateThe}</span>
          {updateLink}
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{messages().deploy.onlineOn}{' '}{view.providerName}</span>
            <span className="text-[13px] text-body">{details}</span>
          </span>
          <Badge tone={display.tone}>
            <StatusDot tone={display.dot} />
            {messages().deploy.online}{' '}{display.label}
          </Badge>
        </div>
        {deployment.status === 'needs_attention' && deployment.statusMessage && <span className="text-[13px] text-amber-strong">{deployment.statusMessage}</span>}
        <div className="flex flex-wrap gap-2">
          {/* Updating is offered only when the release in use is not the one online (the notice above). */}
          {isPaused ? (
            <Button size="sm" variant="secondary" onClick={() => void run({ action: 'resume' }, 'resume')} disabled={busyAction !== null}>
              {busyAction === 'resume' ? messages().deploy.resuming : messages().deploy.resume}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void run({ action: 'pause' }, 'pause')} disabled={busyAction !== null}>
              {busyAction === 'pause' ? messages().deploy.pausing : messages().deploy.pause}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setIsConfirmingOffline(true)} disabled={busyAction !== null}>
            {messages().deploy.takeOffline2}
          </Button>
        </div>
        <span className="text-[12px] leading-normal text-muted">
          {messages().deploy.pauseStopsAnsweringUntilYouResume}{' '}{view.providerName} {messages().deploy.accountYouConfirmFirst}
        </span>
        {isConfirmingOffline && (
          <TakeOfflineConfirmation
            agentName={agentName}
            providerName={view.providerName}
            isBusy={busyAction === 'remove'}
            onCancel={() => setIsConfirmingOffline(false)}
            onConfirm={() => void run({ action: 'remove' }, 'remove')}
          />
        )}
        {errorMessage && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {errorMessage}
          </p>
        )}
      </div>
      {deployment.url && !isPaused && <OnlineFeaturesPanel target={{ kind: 'agent', agentId }} chosen={view.features} changeTo={agentPath('putOnline', agentId, { screen: 'review' })} />}
      <DeployHistory versions={versions} isBusy={busyAction !== null} onRollback={(version) => void run({ action: 'rollback', version }, 'rollback')} />
      <DevelopersDetails>
        <span>
          {deployment.provider === 'fly' ? messages().deploy.flyApp : messages().deploy.deployment} <code>{deployment.app ?? deployment.deploymentName}</code> {messages().deploy.deployed}{' '}{label ?? '–'} {messages().deploy.desktopVersion}{' '}
          {deployment.deployedAgentVersion ?? '–'}{messages().deploy.now}{' '}{view.agentVersion}{messages().deploy.region}{' '}<code>{deployment.region ?? '–'}</code>
        </span>
        {deployment.url && (
          <span>
            {messages().deploy.address}{' '}<code className="break-all">{deployment.url}</code> {messages().deploy.health}{' '}<code>{messages().deploy.getHealthz}</code> {messages().deploy.checked}{' '}{describeTimeAgo(deployment.statusCheckedAt)}
          </span>
        )}
        <span>{view.hasApiKey ? messages().deploy.accessKeyKeptOnThisComputer : messages().deploy.accessKeyNoneSavedOnThis}</span>
        <NewAccessKey agentId={agentId} onViewChange={onViewChange} />
      </DevelopersDetails>
    </section>
  )
}
