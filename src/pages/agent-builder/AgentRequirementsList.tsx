import { useState } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { SecretRequirementForm } from './SecretRequirementForm'

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
  /** not_installed: Install button · needs_setup: Set up link · ready: "Ready". */
  pluginState?: 'not_installed' | 'needs_setup' | 'ready'
  /** Second line, e.g. "Installed · not trusted yet". */
  detail?: string
}

interface AgentRequirementsListProps {
  requirements: BuilderRequirement[]
  /** Saves a workflow secret's value; required when any requirement has a `secretName`. */
  onSaveSecret?: (secretName: string, value: string) => Promise<void>
  /** Installs a plugin the steps use; without it, missing plugins link to Connections. */
  onInstallPlugin?: (pluginName: string) => Promise<void>
}

const actionClassNames = 'flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium no-underline !text-white hover:bg-ink-2'

interface PluginInstallButtonProps {
  requirement: BuilderRequirement
  onInstallPlugin: (pluginName: string) => Promise<void>
}

/** "Install" for a plugin the steps use; shows the error under the row if it fails. */
function PluginInstallButton({ requirement, onInstallPlugin }: PluginInstallButtonProps) {
  const [isInstalling, setIsInstalling] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function install() {
    if (!requirement.pluginName) return
    setIsInstalling(true)
    setErrorMessage(null)
    try {
      await onInstallPlugin(requirement.pluginName)
    } catch (installError) {
      setErrorMessage(`Could not install: ${describeError(installError)}`)
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" aria-label={`Install ${requirement.label}`} disabled={isInstalling} className={joinClassNames(actionClassNames, 'cursor-pointer border-0 disabled:opacity-50')} onClick={() => void install()}>
        {isInstalling ? 'Installing…' : 'Install'}
      </button>
      {errorMessage && (
        <span role="alert" className="text-[12px] text-danger">
          {errorMessage}
        </span>
      )}
    </span>
  )
}

interface RequirementActionProps {
  requirement: BuilderRequirement
  isSecretFormOpen: boolean
  onOpenSecretForm: () => void
  onInstallPlugin?: (pluginName: string) => Promise<void>
}

/** Right side of a "Needs" row: status, or the action that fixes it. */
function RequirementAction({ requirement, isSecretFormOpen, onOpenSecretForm, onInstallPlugin }: RequirementActionProps) {
  if (requirement.isConnected) {
    return <span className="text-[13px] text-ok-strong">{requirement.pluginState === 'ready' ? 'Ready' : 'Connected'}</span>
  }
  if (requirement.secretName !== undefined) {
    if (isSecretFormOpen) return null
    return (
      <button type="button" aria-label={`Add ${requirement.label}`} className={joinClassNames(actionClassNames, 'cursor-pointer border-0')} onClick={onOpenSecretForm}>
        Add
      </button>
    )
  }
  if (requirement.pluginState === 'not_installed' && onInstallPlugin) return <PluginInstallButton requirement={requirement} onInstallPlugin={onInstallPlugin} />
  const linkLabel = requirement.pluginState ? (requirement.pluginState === 'not_installed' ? 'Install' : 'Set up') : 'Connect'
  return (
    <Link to={requirement.connectPath} aria-label={`${linkLabel} ${requirement.label}`} className={actionClassNames}>
      {linkLabel}
    </Link>
  )
}

/** The "Needs" box under the steps on screen 04: each connection with its status or a Connect action. */
export function AgentRequirementsList({ requirements, onSaveSecret, onInstallPlugin }: AgentRequirementsListProps) {
  const [openSecretName, setOpenSecretName] = useState<string | null>(null)
  if (requirements.length === 0) return null

  async function saveSecret(secretName: string, value: string) {
    await onSaveSecret?.(secretName, value)
    setOpenSecretName(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-muted">Needs</span>
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
                  onInstallPlugin={onInstallPlugin}
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
