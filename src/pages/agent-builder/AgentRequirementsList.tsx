import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'

/** One thing the agent needs before it can run, with where to go to connect it. */
export interface BuilderRequirement {
  label: string
  isConnected: boolean
  /** Opened by the Connect button while not connected. */
  connectPath: string
}

/** The "Needs" box under the steps on screen 04: each connection with its status or a Connect action. */
export function AgentRequirementsList({ requirements }: { requirements: BuilderRequirement[] }) {
  if (requirements.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-muted">Needs</span>
      <ul className="m-0 list-none rounded-xl border border-line bg-surface p-0">
        {requirements.map((requirement, requirementIndex) => (
          <li
            key={requirement.label}
            className={joinClassNames('flex items-center justify-between gap-3 px-4 py-3', requirementIndex < requirements.length - 1 && 'border-b border-chip')}
          >
            <span>{requirement.label}</span>
            {requirement.isConnected ? (
              <span className="text-[13px] text-ok-strong">Connected</span>
            ) : (
              <Link
                to={requirement.connectPath}
                aria-label={`Connect ${requirement.label}`}
                className="flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium no-underline !text-white hover:bg-ink-2"
              >
                Connect
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
