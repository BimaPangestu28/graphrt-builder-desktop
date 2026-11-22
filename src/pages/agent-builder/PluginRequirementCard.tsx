import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { Badge, Button, StrokeIcon } from '@/components/ui'
import { whatsAppWebPluginName } from '../connect-whatsapp/useWhatsAppActions'
import { WhatsAppWebLinkPanel } from '../connect-whatsapp/WhatsAppWebLinkPanel'
import { PluginConfigForm } from '../plugins/PluginConfigForm'
import { PluginIcon } from '../plugins/PluginIcon'
import { pluginInstallTrustNote } from '../plugins/pluginDisplay'
import { pluginRuntimeInstallNote } from '../plugins/PluginRuntimeCard'
import { pluginRuntimeDownloadSizeNote } from '@/api/pluginTypes'
import {
  browserDownloadSizeNote,
  describeApprovalAction,
  describeRequirementPermissions,
  describeRequirementState,
  needsPluginApproval,
  needsPluginRuntimeDownload,
} from './pluginRequirementDisplay'
import type { PluginSetupState } from './usePluginSetup'

interface PluginRequirementCardProps {
  requirement: PluginRequirement
  setup: PluginSetupState
}

/** The README's ToS / ban warning, prominent and readable before anything is installed. */
function PluginWarning({ pluginLabel, warning }: { pluginLabel: string; warning: string }) {
  return (
    <div role="note" aria-label={`Warning about ${pluginLabel}`} className="flex flex-col gap-1 rounded-lg border border-amber bg-amber-soft px-3 py-2.5 text-[13px] text-amber-deep">
      <b className="font-semibold">Read before you install</b>
      <span className="leading-normal">{warning}</span>
    </div>
  )
}

function PluginCardHeader({ requirement }: { requirement: PluginRequirement }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <span className="flex min-w-0 items-start gap-3">
        <PluginIcon name={requirement.name} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="font-semibold">{requirement.displayName}</b>
          <span className="text-[13px] text-body">{requirement.description}</span>
        </span>
      </span>
      <Badge tone={requirement.ready ? 'ok' : 'amber'}>{describeRequirementState(requirement)}</Badge>
    </div>
  )
}

/** Step 1: one approval click (install, then trust when it asks for secrets), with install progress. */
function ApprovalAction({ requirement, setup }: PluginRequirementCardProps) {
  const isApproving = setup.approvingNames.includes(requirement.name)
  const actionLabel = describeApprovalAction(requirement)
  const progressText = setup.progressByName[requirement.name]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" aria-label={`${actionLabel} ${requirement.displayName}`} disabled={isApproving || setup.isApprovingAll} onClick={() => void setup.approvePlugin(requirement.name)}>
        {isApproving ? 'Setting up…' : actionLabel}
      </Button>
      <span role="status" className="text-[13px] text-ink-2">
        {isApproving ? (progressText ?? 'Starting the download…') : ''}
      </span>
    </div>
  )
}

/** Downloads Chromium for browser plugins, with the size up front and progress while it runs. */
function BrowserDownloadAction({ setup }: { setup: PluginSetupState }) {
  const { isDownloading, progressText, errorMessage } = setup.browserDownload
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={isDownloading} onClick={() => void setup.downloadBrowser()}>
          {isDownloading ? 'Downloading…' : 'Download browser'}
        </Button>
        <span className="text-[12px] text-muted">Chromium · {browserDownloadSizeNote}</span>
      </div>
      <span role="status" className="text-[13px] text-ink-2">
        {isDownloading ? (progressText ?? 'Starting the download…') : ''}
      </span>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          Could not download the browser: {errorMessage}
        </span>
      )}
    </div>
  )
}

/** Downloads the plugin runtime (Node.js) when the plugin is set up but the runtime is missing (e.g. after an update). */
function PluginRuntimeDownloadAction({ setup }: { setup: PluginSetupState }) {
  const { isDownloading, progressText, errorMessage } = setup.pluginRuntimeDownload
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={isDownloading} onClick={() => void setup.downloadPluginRuntime()}>
          {isDownloading ? 'Downloading…' : 'Install plugin runtime'}
        </Button>
        <span className="text-[12px] text-muted">Node.js · {pluginRuntimeDownloadSizeNote}, once for all plugins</span>
      </div>
      <span role="status" className="text-[13px] text-ink-2">
        {isDownloading ? (progressText ?? 'Starting the download…') : ''}
      </span>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          Could not install the plugin runtime: {errorMessage}
        </span>
      )}
    </div>
  )
}

function ReadyLine() {
  return (
    <span className="flex items-center gap-2 text-[13px] font-medium text-ok-strong">
      <span className="flex size-5 items-center justify-center rounded-full bg-ok-soft">
        <StrokeIcon size={12} strokeWidth={3}>
          <path d="M5 12.5 10 17 19 7" />
        </StrokeIcon>
      </span>
      Ready
    </span>
  )
}

/** Only what is still missing, in order: approval, settings (once installed), plugin runtime, browser, then "Ready". */
function RequirementActions({ requirement, setup }: PluginRequirementCardProps) {
  if (requirement.ready) return <ReadyLine />
  const showsSettings = requirement.installed && requirement.missingConfig.length > 0
  return (
    <div className="flex flex-col gap-3">
      {needsPluginApproval(requirement) && <ApprovalAction requirement={requirement} setup={setup} />}
      {showsSettings && (
        <PluginConfigForm
          pluginLabel={requirement.displayName}
          fields={requirement.missingConfig.map((variable) => ({ variable, configured: false }))}
          onSave={(variable, value) => setup.saveSetting(requirement.name, variable, value)}
          onClear={async () => {}}
        />
      )}
      {needsPluginRuntimeDownload(requirement) && !needsPluginApproval(requirement) && <PluginRuntimeDownloadAction setup={setup} />}
      {requirement.needsBrowser && !requirement.browserReady && <BrowserDownloadAction setup={setup} />}
    </div>
  )
}

/** `whatsapp-web` links by QR code, which needs the plugin installed and trusted and the browser ready. */
function canLinkWhatsAppWeb(requirement: PluginRequirement): boolean {
  return requirement.name === whatsAppWebPluginName && requirement.installed && requirement.trusted && requirement.browserReady
}

/**
 * One plugin the agent needs, in the build chat: what it is, which steps use it, what it
 * asks for, its warning, and the actions that make it ready (plus the QR link for `whatsapp-web`).
 */
export function PluginRequirementCard({ requirement, setup }: PluginRequirementCardProps) {
  const errorMessage = setup.errorByName[requirement.name]
  return (
    <article aria-label={requirement.displayName} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5">
      <PluginCardHeader requirement={requirement} />
      {requirement.usedBySteps.length > 0 && <span className="text-[12px] text-muted">Used by: {requirement.usedBySteps.join(', ')}</span>}
      {requirement.warning && <PluginWarning pluginLabel={requirement.displayName} warning={requirement.warning} />}
      <ul aria-label={`What ${requirement.displayName} asks for`} className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12px] text-body">
        {describeRequirementPermissions(requirement).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {needsPluginApproval(requirement) && needsPluginRuntimeDownload(requirement) && <p className="m-0 text-[12px] text-body">{pluginRuntimeInstallNote}</p>}
      {!requirement.installed && <p className="m-0 text-[12px] font-medium text-ink-2">{pluginInstallTrustNote}</p>}
      <RequirementActions requirement={requirement} setup={setup} />
      {canLinkWhatsAppWeb(requirement) && <WhatsAppWebLinkPanel onSessionChange={setup.reload} />}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </article>
  )
}
