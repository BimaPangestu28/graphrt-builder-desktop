import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { AgentRequirement } from '@/data/mapsLeadsAgent'
import { routePaths } from '@/routes'

/** The "Needs" box under the steps on screen 04: each connection with its status or a Connect action. */
export function AgentRequirementsList({ requirements }: { requirements: AgentRequirement[] }) {
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
                to={routePaths.connectWhatsApp}
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
