import { useState } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { SecretRequirementForm } from './SecretRequirementForm'

/** One thing the agent needs before it can run, with where to go to connect it. */
export interface BuilderRequirement {
  label: string
  isConnected: boolean
  /** Opened by the Connect button while not connected (connections and model keys). */
  connectPath: string
  /** Set for workflow secrets (`env.*`): they are added inline instead of on another screen. */
  secretName?: string
}

interface AgentRequirementsListProps {
  requirements: BuilderRequirement[]
  /** Saves a workflow secret's value; required when any requirement has a `secretName`. */
  onSaveSecret?: (secretName: string, value: string) => Promise<void>
}

const actionClassNames = 'flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium no-underline !text-white hover:bg-ink-2'

/** The "Needs" box under the steps on screen 04: each connection with its status or a Connect action. */
export function AgentRequirementsList({ requirements, onSaveSecret }: AgentRequirementsListProps) {
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
                <span>{requirement.label}</span>
                {requirement.isConnected ? (
                  <span className="text-[13px] text-ok-strong">Connected</span>
                ) : secretName !== undefined ? (
                  !isFormOpen && (
                    <button type="button" aria-label={`Add ${requirement.label}`} className={joinClassNames(actionClassNames, 'cursor-pointer border-0')} onClick={() => setOpenSecretName(secretName)}>
                      Add
                    </button>
                  )
                ) : (
                  <Link to={requirement.connectPath} aria-label={`Connect ${requirement.label}`} className={actionClassNames}>
                    Connect
                  </Link>
                )}
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
