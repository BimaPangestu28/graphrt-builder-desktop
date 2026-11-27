import { useState } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { whatsAppWebPluginName } from '../connect-whatsapp/useWhatsAppActions'
import { PluginSessionLinkAction } from './PluginSessionLinkAction'
import { SecretRequirementForm } from './SecretRequirementForm'
import { messages } from '@/i18n'

/** One thing the agent needs before it can run, with where to go to connect it. */
export interface BuilderRequirement {
  label: string
  isConnected: boolean
  /** Opened by the Connect / Set up link while not connected (connections, model keys, plugins). */
  connectPath: string
  /** Set for workflow secrets (`env.*`): they are added inline instead of on another screen. */
  secretName?: string
  /** Set for plugins the steps use (`<plugin>.<kind>` node types). */
  pluginName?: string
  /**
   * not_installed / needs_setup: "Set up in chat" (or a link to the plugin's page) · not_linked: only the
   * account link is missing (whatsapp-web), "Not linked" with the QR link action · ready: "Ready".
   */
  pluginState?: 'not_installed' | 'needs_setup' | 'not_linked' | 'ready'
  /** Second line, e.g. "Installed · not trusted yet". */
  detail?: string
}

interface AgentRequirementsListProps {
  requirements: BuilderRequirement[]
  /** Saves a workflow secret's value; required when any requirement has a `secretName`. */
  onSaveSecret?: (secretName: string, value: string) => Promise<void>
  /** Shows the plugin setup card in the chat; without it, plugins not ready link to their plugin page. */
  onShowPluginSetup?: () => void
  /** Called after a plugin account link (QR scan) ends, to reload the plugin requirements. */
  onPluginSessionChange?: () => unknown
}

const actionClassNames = 'flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium no-underline !text-inverse hover:bg-ink-2'

interface RequirementActionProps {
  requirement: BuilderRequirement
  isSecretFormOpen: boolean
  onOpenSecretForm: () => void
  onShowPluginSetup?: () => void
  onPluginSessionChange?: () => unknown
}

/** Right side of a "Needs" row: status, or the action that fixes it. */
function RequirementAction({ requirement, isSecretFormOpen, onOpenSecretForm, onShowPluginSetup, onPluginSessionChange }: RequirementActionProps) {
  if (requirement.isConnected) {
    return <span className="text-[13px] text-ok-strong">{requirement.pluginState === 'ready' ? messages().builder.ready : messages().builder.connected}</span>
  }
  if (requirement.pluginState === 'not_linked' && requirement.pluginName === whatsAppWebPluginName) {
    return <PluginSessionLinkAction label={requirement.label} onSessionChange={onPluginSessionChange} />
  }
  if (requirement.secretName !== undefined) {
    if (isSecretFormOpen) return null
    return (
      <button type="button" aria-label={messages().builder.addLabel(requirement.label)} className={joinClassNames(actionClassNames, 'cursor-pointer border-0')} onClick={onOpenSecretForm}>
        {messages().builder.add}
      </button>
    )
  }
  if (requirement.pluginState && onShowPluginSetup) {
    return (
      <button type="button" aria-label={messages().builder.setUpLabelInChat(requirement.label)} className={joinClassNames(actionClassNames, 'cursor-pointer border-0')} onClick={onShowPluginSetup}>
        {messages().builder.setUpInChat}
      </button>
    )
  }
  const linkLabel = requirement.pluginState ? (requirement.pluginState === 'not_installed' ? messages().builder.install : messages().builder.setUp) : messages().builder.connect
  return (
    <Link to={requirement.connectPath} aria-label={`${linkLabel} ${requirement.label}`} className={actionClassNames}>
      {linkLabel}
    </Link>
  )
}

/** The "Needs" box under the steps on screen 04: each connection with its status or a Connect action. */
export function AgentRequirementsList({ requirements, onSaveSecret, onShowPluginSetup, onPluginSessionChange }: AgentRequirementsListProps) {
  const [openSecretName, setOpenSecretName] = useState<string | null>(null)
  if (requirements.length === 0) return null

  async function saveSecret(secretName: string, value: string) {
    await onSaveSecret?.(secretName, value)
    setOpenSecretName(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-muted">{messages().builder.needs}</span>
      <ul className="m-0 list-none rounded-xl border border-line bg-surface p-0">
        {requirements.map((requirement, requirementIndex) => {
          const { secretName } = requirement
          const isFormOpen = secretName !== undefined && openSecretName === secretName
          return (
            <li key={requirement.label} className={joinClassNames(requirementIndex < requirements.length - 1 && 'border-b border-chip')}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{requirement.label}</span>
                  {requirement.detail && <span className="text-[12px] text-muted">{requirement.detail}</span>}
                </span>
                <RequirementAction
                  requirement={requirement}
                  isSecretFormOpen={isFormOpen}
                  onOpenSecretForm={() => secretName !== undefined && setOpenSecretName(secretName)}
                  onShowPluginSetup={onShowPluginSetup}
                  onPluginSessionChange={onPluginSessionChange}
                />
              </div>
              {isFormOpen && secretName !== undefined && (
                <SecretRequirementForm secretName={secretName} onSave={(value) => saveSecret(secretName, value)} onCancel={() => setOpenSecretName(null)} />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
