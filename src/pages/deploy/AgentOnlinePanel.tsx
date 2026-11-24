import { useEffect, useId, useState } from 'react'
import { listDeployedVersions, manageAgentDeployment } from '@/api/deploy'
import type { DeployedVersion, DeploymentView, ManageAction } from '@/api/deployTypes'
import { Badge, Button, LinkButton, StatusDot } from '@/components/ui'
import { agentPath } from '@/routes'
import { DevelopersDetails } from './DeployDialog'
import { deployModeLabels, describeDeploymentStatus, describeTimeAgo, plainErrorMessage, serverAreaLabels } from './deployDisplay'

/** "On this computer" or "Online · working / paused / needs attention" under the agent's name. */
export function RunPlaceBadge({ view }: { view: DeploymentView | null }) {
  if (!view || view.deployment.status === 'failed') {
    return <Badge>On this computer</Badge>
  }
  const display = describeDeploymentStatus(view.deployment.status)
  return (
    <Badge tone={display.tone}>
      <StatusDot tone={display.dot} />
      Online · {display.label}
    </Badge>
  )
}

function TakeOfflineConfirmation({ agentName, providerName, onConfirm, onCancel, isBusy }: { agentName: string; providerName: string; onConfirm: () => void; onCancel: () => void; isBusy: boolean }) {
  const [typedName, setTypedName] = useState('')
  const inputId = useId()
  return (
    <div role="alertdialog" aria-label="Take offline?" className="flex flex-col gap-3 rounded-xl border border-danger-line bg-danger-tint p-4">
      <span className="font-semibold text-danger-deep">Take “{agentName}” offline?</span>
      <span className="text-[13px] leading-normal text-body">
        This removes the online copy, its storage and its keys from your {providerName} account. It keeps working on this computer.
      </span>
      <label htmlFor={inputId} className="text-[13px] text-ink-2">
        Type the agent's name to confirm
      </label>
      <input id={inputId} value={typedName} onChange={(event) => setTypedName(event.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-[14px]" />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={isBusy || typedName.trim() !== agentName.trim()} className="bg-danger !text-white hover:bg-danger-deep">
          {isBusy ? 'Taking offline…' : 'Take offline'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isBusy}>
          Keep it online
        </Button>
      </div>
    </div>
  )
}

function DeployHistory({ versions, onRollback, isBusy }: { versions: DeployedVersion[]; onRollback: (label: string) => void; isBusy: boolean }) {
  if (versions.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[14px] font-semibold">History</h3>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {versions.map((version, index) => (
          <li key={version.label} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
            <span className="flex flex-col">
              <span className="font-medium">{version.isCurrent ? 'Online now' : index === versions.length - 1 ? 'First time online' : 'Earlier version'}</span>
              <span className="text-[13px] text-body">
                {new Date(version.deployedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {version.changeSummary && ` · “${version.changeSummary}”`}
              </span>
            </span>
            {version.isCurrent ? (
              <Badge tone="ok">Current</Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => onRollback(version.label)} disabled={isBusy}>
                Go back to this
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
      <section aria-label="Online" className="flex flex-col gap-2 rounded-[14px] border border-danger-line bg-danger-tint p-4">
        <span className="font-semibold text-danger-deep">It didn't go online</span>
        <span className="text-[13px] text-body">{deployment.statusMessage ?? 'The last try failed.'}</span>
        <LinkButton to={agentPath('putOnline', agentId)} size="sm" className="w-fit">
          Try again
        </LinkButton>
      </section>
    )
  }

  const isPaused = deployment.status === 'paused'
  const display = describeDeploymentStatus(deployment.status)
  const details = [`Last update: ${describeTimeAgo(deployment.updatedAt)}`, deployModeLabels[deployment.mode].title, view.area ? serverAreaLabels[view.area] : null].filter(Boolean).join(' · ')
  const updateLink = (
    <LinkButton to={agentPath('putOnline', agentId, { screen: 'review' })} size="sm">
      Update with latest changes
    </LinkButton>
  )

  return (
    <section aria-label="Online" className="flex flex-col gap-4">
      {view.hasChanges && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-line bg-amber-tint px-4 py-3">
          <span className="font-medium text-amber-deep">You changed this agent — update the online version?</span>
          {updateLink}
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">Online on {view.providerName}</span>
            <span className="text-[13px] text-body">{details}</span>
          </span>
          <Badge tone={display.tone}>
            <StatusDot tone={display.dot} />
            Online · {display.label}
          </Badge>
        </div>
        {deployment.status === 'needs_attention' && deployment.statusMessage && <span className="text-[13px] text-amber-strong">{deployment.statusMessage}</span>}
        <div className="flex flex-wrap gap-2">
          {updateLink}
          {isPaused ? (
            <Button size="sm" variant="secondary" onClick={() => void run({ action: 'resume' }, 'resume')} disabled={busyAction !== null}>
              {busyAction === 'resume' ? 'Resuming…' : 'Resume'}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void run({ action: 'pause' }, 'pause')} disabled={busyAction !== null}>
              {busyAction === 'pause' ? 'Pausing…' : 'Pause'}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setIsConfirmingOffline(true)} disabled={busyAction !== null}>
            Take offline
          </Button>
        </div>
        <span className="text-[12px] leading-normal text-muted">
          Pause stops answering until you resume. Take offline removes the online copy from your {view.providerName} account (you confirm first).
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
      <DeployHistory versions={versions} isBusy={busyAction !== null} onRollback={(version) => void run({ action: 'rollback', version }, 'rollback')} />
      <DevelopersDetails>
        <span>
          {deployment.provider === 'fly' ? 'Fly app' : 'Deployment'} <code>{deployment.app ?? deployment.deploymentName}</code> · deployed {label ?? '–'} (desktop version{' '}
          {deployment.deployedAgentVersion ?? '–'}, now {view.agentVersion}) · region <code>{deployment.region ?? '–'}</code>
        </span>
        {deployment.url && (
          <span>
            Address <code className="break-all">{deployment.url}</code> · health <code>GET /healthz</code> checked {describeTimeAgo(deployment.statusCheckedAt)}
          </span>
        )}
      </DevelopersDetails>
    </section>
  )
}
