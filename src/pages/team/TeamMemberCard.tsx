import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import type { TeamMember } from '@/api/chainTypes'
import { agentPath } from '@/routes'

export type TeamMemberState = 'done' | 'working' | 'needsYou' | 'failed' | 'waiting' | 'paused'

const memberStateStyles: Record<TeamMemberState, { label: string; cardClassNames: string; labelClassNames: string }> = {
  done: { label: 'Done', cardClassNames: 'border-line', labelClassNames: 'text-muted' },
  working: { label: 'Working', cardClassNames: 'border-brand-line-2 bg-brand-tint', labelClassNames: 'font-semibold text-brand-strong' },
  needsYou: { label: 'Needs you', cardClassNames: 'border-amber-line bg-amber-tint', labelClassNames: 'font-semibold text-amber-strong' },
  failed: { label: 'Failed', cardClassNames: 'border-amber-line', labelClassNames: 'font-semibold text-amber-strong' },
  waiting: { label: 'Waiting', cardClassNames: 'border-line', labelClassNames: 'text-muted' },
  paused: { label: 'Paused', cardClassNames: 'border-line', labelClassNames: 'text-muted' },
}

/**
 * A member's state from its own status and its latest run.
 *
 * @param member - The member agent (TeamMember)
 * @returns Paused when the agent is paused, otherwise what its latest run is doing (TeamMemberState)
 */
export function readMemberState(member: TeamMember): TeamMemberState {
  if (member.status === 'paused') return 'paused'
  switch (member.latestRun?.status) {
    case 'running':
      return 'working'
    case 'paused':
      return 'needsYou'
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      return 'waiting'
  }
}

/**
 * One member agent of the team with its current state.
 * When the team is paused every member that is not done shows "Paused" instead of its own state.
 */
export function TeamMemberCard({ member, isTeamPaused }: { member: TeamMember; isTeamPaused: boolean }) {
  const memberState = readMemberState(member)
  const shownState = isTeamPaused && memberState !== 'done' ? 'paused' : memberState
  const stateStyle = memberStateStyles[shownState]
  return (
    <div className={joinClassNames('flex flex-col gap-2 rounded-xl border p-3.5', stateStyle.cardClassNames)}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{member.name}</span>
        <span className={joinClassNames('text-[12px]', stateStyle.labelClassNames)}>{stateStyle.label}</span>
      </div>
      <span className="text-[13px] text-body">Agent · v{member.currentVersion}</span>
      {memberState === 'needsYou' && member.latestRun ? (
        <Link to={agentPath('testRun', member.agentId, { runId: member.latestRun.id })} className="text-[13px] font-medium">
          {member.description || 'Answer its question'}
        </Link>
      ) : (
        <span className="text-[13px] leading-normal">{member.description}</span>
      )}
    </div>
  )
}
