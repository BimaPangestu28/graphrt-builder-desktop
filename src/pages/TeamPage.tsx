import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { setAgentStatus } from '@/api/agents'
import { addTeamMember, getTeam, listAgentSteps } from '@/api/chains'
import type { AgentStepInfo, TeamOverview } from '@/api/chainTypes'
import { subscribeToRunEvents } from '@/api/runs'
import { getTeamGuardrails, listCoordinatorChat, listTeamActivity, sendCoordinatorMessage, setTeamMaxAgentCalls } from '@/api/teams'
import type { RunEventPayload } from '@/api/types'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useBackendSubscription } from '@/hooks/useBackendSubscription'
import { AddMemberForm } from './team/AddMemberForm'
import { CoordinatorChat } from './team/CoordinatorChat'
import { TeamActivityLog } from './team/TeamActivityLog'
import { TeamGuardrailsPanel } from './team/TeamGuardrailsPanel'
import { TeamMemberCard } from './team/TeamMemberCard'
import { messages } from '@/i18n'

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
            {isPaused ? messages().team.paused : messages().team.working}
          </span>
        </div>
        <span className="text-body">{team.description}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" className={headerButtonClassNames} onClick={onAddMember}>
          {messages().team.addMember}
        </button>
        <button type="button" className={headerButtonClassNames} aria-pressed={isPaused} disabled={isBusy} onClick={onTogglePaused}>
          {isPaused ? messages().team.resumeTeam : messages().team.pauseTeam}
        </button>
      </div>
    </div>
  )
}

/** Run events that change what the team screen shows (a member call, a run ending). */
function changesTeamView(payload: RunEventPayload): boolean {
  const eventType = (payload.event as { type?: string }).type ?? ''
  return eventType.startsWith('run_') || eventType === 'node_progress'
}

/**
 * Screen 13 · Team of agents.
 * A team is an agent whose coordinator `agent` step may call member agents as tools. Members, adding a
 * member and pausing (the team agent's status) come from the backend. The coordinator chat shows the
 * team agent's runs (a message starts one), the activity log reads those runs' member calls and the
 * members' own runs, and the guardrails are the limits the app enforces. Run events refresh both.
 */
export function TeamPage() {
  const [searchParams] = useSearchParams()
  const teamAgentId = searchParams.get('agentId') ?? defaultTeamAgentId
  const { data, error, reload } = useAsyncData(() => loadTeamScreen(teamAgentId), [teamAgentId])
  const [isPickingMember, setIsPickingMember] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const activity = useAsyncData(() => listTeamActivity(teamAgentId), [teamAgentId])
  const chat = useAsyncData(() => listCoordinatorChat(teamAgentId), [teamAgentId])
  const guardrails = useAsyncData(() => getTeamGuardrails(teamAgentId), [teamAgentId])
  const [isSavingGuardrail, setIsSavingGuardrail] = useState(false)
  const memberAgentIds = new Set(data?.team.members.map((member) => member.agentId))

  useBackendSubscription(subscribeToRunEvents, (payload: RunEventPayload) => {
    const isTeamRun = payload.agentId === teamAgentId || memberAgentIds.has(payload.agentId)
    if (!isTeamRun || !changesTeamView(payload)) return
    void activity.reload()
    void chat.reload()
  })

  const sendToCoordinator = async (message: string) => {
    await sendCoordinatorMessage(teamAgentId, message)
    await Promise.all([chat.reload(), activity.reload()])
  }

  const saveAgentCallLimit = async (limit: number | null) => {
    setIsSavingGuardrail(true)
    setActionError(null)
    try {
      await setTeamMaxAgentCalls(teamAgentId, limit)
      await guardrails.reload()
    } catch (rawError) {
      setActionError(rawError instanceof Error ? rawError.message : messages().team.couldNotSaveTheGuardrail)
    } finally {
      setIsSavingGuardrail(false)
    }
  }

  const runAction = async (action: () => Promise<unknown>) => {
    setIsBusy(true)
    setActionError(null)
    try {
      await action()
      await reload()
    } catch (rawError) {
      setActionError(rawError instanceof Error ? rawError.message : messages().team.somethingWentWrong)
    } finally {
      setIsBusy(false)
    }
  }

  const team = data?.team
  const memberIds = new Set(team?.members.map((member) => member.agentId))
  const candidates = (data?.catalog ?? []).filter((agent) => agent.usableAsStep && agent.agentId !== teamAgentId && !memberIds.has(agent.agentId))

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: teamAgentId }} mainClassName="flex flex-wrap">
      <CoordinatorChat teamAgentId={teamAgentId} exchanges={chat.data} onSend={sendToCoordinator} />
      <div className="box-border flex min-w-0 flex-[2_1_520px] flex-col gap-6 px-7 py-6">
        {error && (
          <p role="alert" className="m-0 text-amber-strong">
            {messages().team.couldNotLoadTheTeam}{' '}{error.message}
          </p>
        )}
        {!team && !error && <p className="m-0 text-muted">{messages().team.loadingTheTeam}</p>}
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
            <section aria-label={messages().team.members} className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
              {team.members.length === 0 && <p className="m-0 text-[13px] text-muted">{messages().team.noMembersYetAddOneOf}</p>}
              {team.members.map((member) => (
                <TeamMemberCard key={member.agentId} member={member} isTeamPaused={team.status === 'paused'} />
              ))}
            </section>
          </>
        )}
        <div className="flex flex-wrap gap-5">
          <TeamActivityLog entries={activity.data} error={activity.error} />
          <TeamGuardrailsPanel guardrails={guardrails.data} isSaving={isSavingGuardrail} onSaveLimit={(limit) => void saveAgentCallLimit(limit)} />
        </div>
      </div>
    </AppShell>
  )
}
