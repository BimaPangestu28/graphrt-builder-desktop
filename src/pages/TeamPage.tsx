import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { teamActivity, teamGoalSummary, teamGuardrails, teamMembers, teamName } from '@/data/team'
import { routePaths } from '@/routes'
import { CoordinatorChat } from './team/CoordinatorChat'
import { TeamMemberCard } from './team/TeamMemberCard'

const headerButtonClassNames = 'h-9 cursor-pointer rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-subtle'

interface TeamHeaderProps {
  isPaused: boolean
  onTogglePaused: () => void
}

function TeamHeader({ isPaused, onTogglePaused }: TeamHeaderProps) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">{teamName}</h1>
          <span className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isPaused ? 'bg-selected text-ink-2' : 'bg-ok-soft text-ok-strong')}>
            {isPaused ? 'Paused' : 'Working'}
          </span>
        </div>
        <span className="text-body">{teamGoalSummary}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" className={headerButtonClassNames} onClick={() => navigate(routePaths.newAgent)}>
          Add member
        </button>
        <button type="button" className={headerButtonClassNames} aria-pressed={isPaused} onClick={onTogglePaused}>
          {isPaused ? 'Resume team' : 'Pause team'}
        </button>
      </div>
    </div>
  )
}

function TeamActivityLog() {
  return (
    <section aria-labelledby="team-activity-heading" className="flex min-w-0 flex-[3_1_320px] flex-col gap-3">
      <h2 id="team-activity-heading" className="m-0 text-[15px] font-semibold">
        Activity
      </h2>
      <ol className="m-0 flex list-none flex-col p-0">
        {teamActivity.map((activity) => (
          <li key={activity.time} className="flex gap-3 border-b border-chip py-2.5 last:border-b-0">
            <span className="w-11 shrink-0 text-[12px] text-muted">{activity.time}</span>
            <span className="leading-normal">
              {activity.parts.map((part, partIndex) => (part.isMember ? <b key={partIndex} className="font-semibold">{part.text}</b> : <span key={partIndex}>{part.text}</span>))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function TeamGuardrails() {
  return (
    <section aria-labelledby="team-guardrails-heading" className="flex min-w-0 flex-[2_1_240px] flex-col gap-3">
      <h2 id="team-guardrails-heading" className="m-0 text-[15px] font-semibold">
        Guardrails
      </h2>
      <dl className="m-0 rounded-xl border border-line px-3.5 py-1">
        {teamGuardrails.map((guardrail) => (
          <div key={guardrail.label} className="flex justify-between gap-2 border-b border-chip py-2.5 last:border-b-0">
            <dt className="text-body">{guardrail.label}</dt>
            <dd className="m-0 text-right font-medium">{guardrail.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * Screen 13 · Team of agents.
 * A coordinator agent turns one goal into a plan for several member agents; the user can chat with it,
 * watch each member's progress and activity, and pause the whole team.
 */
export function TeamPage() {
  const [isPaused, setIsPaused] = useState(false)
  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'sales-team' }} mainClassName="flex flex-wrap">
      <CoordinatorChat />
      <div className="box-border flex min-w-0 flex-[2_1_520px] flex-col gap-6 px-7 py-6">
        <TeamHeader isPaused={isPaused} onTogglePaused={() => setIsPaused((current) => !current)} />
        <section aria-label="Members" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
          {teamMembers.map((member) => (
            <TeamMemberCard key={member.id} member={member} isTeamPaused={isPaused} />
          ))}
        </section>
        <div className="flex flex-wrap gap-5">
          <TeamActivityLog />
          <TeamGuardrails />
        </div>
      </div>
    </AppShell>
  )
}
