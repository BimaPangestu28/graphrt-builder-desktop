import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { setAgentStatus } from '@/api/agents'
import { addTeamMember, getTeam, listAgentSteps } from '@/api/chains'
import type { AgentStepInfo, TeamOverview } from '@/api/chainTypes'
import { teamActivity, teamGuardrails } from '@/data/team'
import { useAsyncData } from '@/hooks/useAsyncData'
import { AddMemberForm } from './team/AddMemberForm'
import { CoordinatorChat } from './team/CoordinatorChat'
import { TeamMemberCard } from './team/TeamMemberCard'

/** Team agent shown without `?agentId=` (the sample team). */
const defaultTeamAgentId = 'sales-team'

const headerButtonClassNames = 'h-9 cursor-pointer rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-subtle'

interface TeamScreenData {
  team: TeamOverview
  catalog: AgentStepInfo[]
}

async function loadTeamScreen(agentId: string): Promise<TeamScreenData> {
  const [team, catalog] = await Promise.all([getTeam(agentId), listAgentSteps()])
  return { team, catalog }
}

interface TeamHeaderProps {
  team: TeamOverview
  isBusy: boolean
  onAddMember: () => void
  onTogglePaused: () => void
}

function TeamHeader({ team, isBusy, onAddMember, onTogglePaused }: TeamHeaderProps) {
  const isPaused = team.status === 'paused'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">{team.name}</h1>
          <span className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isPaused ? 'bg-selected text-ink-2' : 'bg-ok-soft text-ok-strong')}>
            {isPaused ? 'Paused' : 'Working'}
          </span>
        </div>
        <span className="text-body">{team.description}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" className={headerButtonClassNames} onClick={onAddMember}>
          Add member
        </button>
        <button type="button" className={headerButtonClassNames} aria-pressed={isPaused} disabled={isBusy} onClick={onTogglePaused}>
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
 * A team is an agent whose coordinator `agent` step may call member agents as tools. Members, adding a
 * member and pausing (the team agent's status) come from the backend; the coordinator chat, activity
 * and guardrails are still sample content.
 */
export function TeamPage() {
  const [searchParams] = useSearchParams()
  const teamAgentId = searchParams.get('agentId') ?? defaultTeamAgentId
  const { data, error, reload } = useAsyncData(() => loadTeamScreen(teamAgentId), [teamAgentId])
  const [isPickingMember, setIsPickingMember] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const runAction = async (action: () => Promise<unknown>) => {
    setIsBusy(true)
    setActionError(null)
    try {
      await action()
      await reload()
    } catch (rawError) {
      setActionError(rawError instanceof Error ? rawError.message : 'Something went wrong')
    } finally {
      setIsBusy(false)
    }
  }

  const team = data?.team
  const memberIds = new Set(team?.members.map((member) => member.agentId))
  const candidates = (data?.catalog ?? []).filter((agent) => agent.usableAsStep && agent.agentId !== teamAgentId && !memberIds.has(agent.agentId))

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'sales-team' }} mainClassName="flex flex-wrap">
      <CoordinatorChat />
      <div className="box-border flex min-w-0 flex-[2_1_520px] flex-col gap-6 px-7 py-6">
        {error && (
          <p role="alert" className="m-0 text-amber-strong">
            Could not load the team: {error.message}
          </p>
        )}
        {!team && !error && <p className="m-0 text-muted">Loading the team…</p>}
        {team && (
          <>
            <TeamHeader
              team={team}
              isBusy={isBusy}
              onAddMember={() => setIsPickingMember(true)}
              onTogglePaused={() => void runAction(() => setAgentStatus(team.agentId, team.status === 'paused' ? 'active' : 'paused'))}
            />
            {actionError && (
              <p role="alert" className="m-0 rounded-[10px] bg-amber-tint px-3.5 py-2.5 text-[13px] text-amber-strong">
                {actionError}
              </p>
            )}
            {isPickingMember && (
              <AddMemberForm
                candidates={candidates}
                isAdding={isBusy}
                onCancel={() => setIsPickingMember(false)}
                onAdd={(memberAgentId) =>
                  void runAction(async () => {
                    await addTeamMember(team.agentId, memberAgentId, () => {})
                    setIsPickingMember(false)
                  })
                }
              />
            )}
            <section aria-label="Members" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
              {team.members.length === 0 && <p className="m-0 text-[13px] text-muted">No members yet. Add one of your agents</p>}
              {team.members.map((member) => (
                <TeamMemberCard key={member.agentId} member={member} isTeamPaused={team.status === 'paused'} />
              ))}
            </section>
          </>
        )}
        <div className="flex flex-wrap gap-5">
          <TeamActivityLog />
          <TeamGuardrails />
        </div>
      </div>
    </AppShell>
  )
}
