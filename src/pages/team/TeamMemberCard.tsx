import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { TeamMember, TeamMemberState } from '@/data/team'
import { routePaths } from '@/routes'

const memberStateStyles: Record<TeamMemberState, { label: string; cardClassNames: string; labelClassNames: string }> = {
  done: { label: 'Done', cardClassNames: 'border-line', labelClassNames: 'text-muted' },
  working: { label: 'Working', cardClassNames: 'border-brand-line-2 bg-brand-tint', labelClassNames: 'font-semibold text-brand-strong' },
  needsYou: { label: 'Needs you', cardClassNames: 'border-amber-line bg-amber-tint', labelClassNames: 'font-semibold text-amber-strong' },
  waiting: { label: 'Waiting', cardClassNames: 'border-line', labelClassNames: 'text-muted' },
}

/**
 * One member agent of the team with its current state.
 * When the team is paused every member shows "Paused" instead of its own state.
 */
export function TeamMemberCard({ member, isTeamPaused }: { member: TeamMember; isTeamPaused: boolean }) {
  const stateStyle = memberStateStyles[member.state]
  const showsOwnState = !isTeamPaused || member.state === 'done'
  return (
    <div className={joinClassNames('flex flex-col gap-2 rounded-xl border p-3.5', showsOwnState ? stateStyle.cardClassNames : 'border-line')}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{member.name}</span>
        <span className={joinClassNames('text-[12px]', showsOwnState ? stateStyle.labelClassNames : 'text-muted')}>{showsOwnState ? stateStyle.label : 'Paused'}</span>
      </div>
      <span className="text-[13px] text-body">{member.agentLabel}</span>
      {member.state === 'needsYou' ? (
        <Link to={routePaths.batchApproval} className="text-[13px] font-medium">
          {member.progress}
        </Link>
      ) : (
        <span className="text-[13px] leading-normal">{member.progress}</span>
      )}
    </div>
  )
}
