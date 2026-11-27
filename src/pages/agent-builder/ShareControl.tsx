import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createInvite,
  createTeam,
  getAgentCollab,
  getCollabStatus,
  getTeam,
  joinTeam,
  listTeams,
  onAgentCollabChanged,
  onSharedAgentChanged,
  openTeamAgent,
  previewInvite,
  shareAgent,
  stopSharingAgent,
} from '@/api/collab'
import type { AgentCollab, CollabRole, CollabStatus, CollabWorkspace, CollabWorkspaceDetail, InvitePreview } from '@/api/collabTypes'
import { isDesktopApp } from '@/api/client'
import type { Agent } from '@/api/types'
import { Badge, Button, Icon } from '@/components/ui'
import { notifyAgentsChanged } from '@/hooks/useAgents'
import { messages, useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, routePaths } from '@/routes'
import { keepSectionAcrossLanguageSwitch } from '../settings/languageSwitch'
import { Avatar } from '../settings/TeamServerSection'

/** The label of a role. */
export function roleLabel(role: CollabRole | string | null | undefined): string {
  const text = messages().collab
  if (role === 'owner') return text.roleOwner
  if (role === 'operator') return text.roleOperator
  return text.roleViewer
}

interface ShareControlProps {
  agent: Agent
  /** Reloads the agent (after someone else changed it). */
  onRemoteChange: () => Promise<void> | void
}

/**
 * The agent header's team part: who else is here (avatars), the connection, and Share.
 * Nothing shows a network call until Share is opened; a local agent stays local.
 */
export function ShareControl({ agent, onRemoteChange }: ShareControlProps) {
  const t = useT().collab
  const [state, setState] = useState<AgentCollab | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      setState(await getAgentCollab(agent.id))
    } catch {
      setState(null)
    }
  }, [agent.id])

  useEffect(() => {
    void reload()
    const stops: Array<Promise<() => void>> = [
      onAgentCollabChanged((changed) => changed === agent.id && void reload()),
      onSharedAgentChanged((changed) => {
        if (changed !== agent.id) return
        void onRemoteChange()
        notifyAgentsChanged()
      }),
    ]
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()))
  }, [agent.id, reload, onRemoteChange])

  if (!isDesktopApp()) return null
  const people = state?.people ?? []
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state?.shared && (
        <span className="flex items-center gap-2" aria-live="polite">
          {people.length > 0 && (
            <span className="flex -space-x-1.5" aria-label={t.onlineNow(people.map((p) => p.name).join(', '))}>
              {people.slice(0, 5).map((person) => (
                <Avatar key={person.id} name={person.name} color={person.color} />
              ))}
            </span>
          )}
          {state.readOnly && <Badge tone="amber">{t.viewOnly}</Badge>}
          <span className="text-[12px] text-muted">{t.connection[state.connection] ?? state.connection}</span>
        </span>
      )}
      <Button variant={state?.shared ? 'ghost' : 'secondary'} size="sm" onClick={() => setIsOpen(true)}>
        <Icon name="user" size={14} />
        {state?.shared ? t.shared : t.share}
      </Button>
      {isOpen && (
        <ShareDialog
          agent={agent}
          state={state}
          onClose={() => setIsOpen(false)}
          onChanged={(changed) => {
            setState(changed)
            notifyAgentsChanged()
          }}
        />
      )}
    </div>
  )
}

interface ShareDialogProps {
  agent: Agent
  state: AgentCollab | null
  onClose: () => void
  onChanged: (state: AgentCollab) => void
}

/** Share with a team, invite, see the people, join a team, open the team's agents. */
function ShareDialog({ agent, state, onClose, onChanged }: ShareDialogProps) {
  const t = useT().collab
  const titleId = useId()
  const navigate = useNavigate()
  const [status, setStatus] = useState<CollabStatus | null>(null)
  const [teams, setTeams] = useState<CollabWorkspace[]>([])
  const [mayCreate, setMayCreate] = useState(false)
  const [teamId, setTeamId] = useState<string>('')
  const [team, setTeam] = useState<CollabWorkspaceDetail | null>(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [inviteRole, setInviteRole] = useState<'viewer' | 'operator'>('operator')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [joinLink, setJoinLink] = useState('')
  const [joinName, setJoinName] = useState('')
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sharedTeamId = state?.link?.workspaceId ?? null

  const loadTeams = useCallback(async () => {
    const loadedStatus = await getCollabStatus()
    setStatus(loadedStatus)
    if (!loadedStatus.signedIn) return
    const listed = await listTeams()
    setTeams(listed.workspaces)
    setMayCreate(listed.mayCreate)
    setTeamId((current) => current || sharedTeamId || listed.workspaces[0]?.id || '')
  }, [sharedTeamId])

  useEffect(() => {
    void loadTeams().catch((loadError) => setError(t.couldNot(describeError(loadError))))
  }, [loadTeams, t])

  useEffect(() => {
    if (!teamId) return setTeam(null)
    void getTeam(teamId).then(setTeam).catch(() => setTeam(null))
  }, [teamId, state])

  async function run(kind: string, action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (actionError) {
      setError(t.couldNot(describeError(actionError)))
    } finally {
      setBusy(null)
    }
  }

  const isOwner = team?.role === 'owner'
  const otherAgents = (team?.projects_list ?? []).filter((project) => project.id !== state?.link?.projectId)

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 box-border flex items-start justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6" onClick={onClose}>
      <div className="flex w-full max-w-[520px] flex-col gap-4 rounded-2xl bg-surface p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="m-0 text-[18px] font-semibold">
              {state?.shared && state.link ? t.sharedWith(state.link.workspaceName) : t.shareTitle}
            </h2>
            {!state?.shared && <span className="text-[13px] text-body">{t.shareIntro}</span>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t.close}>
            <Icon name="close" size={14} />
          </Button>
        </div>

        {status && !status.signedIn && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px] text-body">
            {t.notSignedIn}
            <Button size="sm" variant="secondary" onClick={() => {
                keepSectionAcrossLanguageSwitch('team')
                navigate(routePaths.settings)
              }}>
              {t.openSettings}
            </Button>
          </div>
        )}

        {status?.signedIn && !state?.shared && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              {t.chooseTeam}
              <select
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="h-9 rounded-[9px] border border-line-strong bg-surface px-2.5 text-[14px]"
              >
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
                {mayCreate && <option value="">{t.newTeam}</option>}
              </select>
            </label>
            {teamId === '' && mayCreate && (
              <div className="flex gap-2">
                <input
                  aria-label={t.newTeamName}
                  placeholder={t.newTeamName}
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  maxLength={120}
                  className="h-9 min-w-0 flex-1 rounded-[9px] border border-line-strong px-2.5 text-[14px]"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null || newTeamName.trim() === ''}
                  onClick={() =>
                    void run('create', async () => {
                      const created = await createTeam(newTeamName.trim())
                      await loadTeams()
                      setTeamId(created.id)
                    })
                  }
                >
                  {t.createTeam}
                </Button>
              </div>
            )}
            {teamId && (
              <Button
                disabled={busy !== null}
                onClick={() => void run('share', async () => onChanged(await shareAgent(agent.id, teamId)))}
              >
                {busy === 'share' ? t.sharing : t.shareWithTeam(teams.find((option) => option.id === teamId)?.name ?? '')}
              </Button>
            )}
          </div>
        )}

        {status?.signedIn && team && (state?.shared || teamId) && (
          <>
            {isOwner && (
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-semibold">{t.invite}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={t.invite}
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as 'viewer' | 'operator')}
                    className="h-9 rounded-[9px] border border-line-strong bg-surface px-2.5 text-[14px]"
                  >
                    <option value="operator">{t.inviteToEdit}</option>
                    <option value="viewer">{t.inviteToView}</option>
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('invite', async () => {
                        const invite = await createInvite(team.id, inviteRole)
                        setInviteLink(invite.link)
                        setIsCopied(false)
                      })
                    }
                  >
                    {t.createLink}
                  </Button>
                </div>
                {inviteLink && (
                  <div className="flex flex-col gap-1">
                    <code className="break-all rounded-lg bg-subtle px-2.5 py-2 font-mono text-[12px]">{inviteLink}</code>
                    <span className="flex items-center gap-2 text-[12px] text-muted">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(inviteLink)
                          setIsCopied(true)
                        }}
                      >
                        {isCopied ? t.copied : t.copy}
                      </Button>
                      {t.linkHint}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold">{t.people}</span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {team.members_list.map((member) => (
                  <li key={member.id} className="flex items-center gap-2 text-[14px]">
                    <Avatar name={member.name} color={member.color} />
                    <span className="flex-1 truncate">{member.name}</span>
                    <span className="text-[12px] text-muted">{roleLabel(member.role)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {otherAgents.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-semibold">{t.teamAgents}</span>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {otherAgents.map((project) => (
                    <li key={project.id} className="flex items-center gap-2 text-[14px]">
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.online.length > 0 && <span className="text-[12px] text-muted">{t.onlineNow(project.online.map((p) => p.name).join(', '))}</span>}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`open-${project.id}`, async () => {
                            const agentId = await openTeamAgent(team.id, project.id)
                            notifyAgentsChanged()
                            onClose()
                            navigate(agentPath('builder', agentId))
                          })
                        }
                      >
                        {busy === `open-${project.id}` ? t.opening : t.open}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-[14px] font-semibold">{t.join}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <span className="text-[13px] text-body">{t.joinIntro}</span>
            <input
              aria-label={t.joinLinkLabel}
              placeholder="https://collab.example.com/join#…"
              value={joinLink}
              onChange={(event) => {
                setJoinLink(event.target.value)
                setPreview(null)
              }}
              onBlur={() => {
                if (joinLink.trim()) void previewInvite(joinLink.trim()).then(setPreview).catch((previewError) => setError(t.couldNot(describeError(previewError))))
              }}
              spellCheck={false}
              className="h-9 rounded-[9px] border border-line-strong px-2.5 font-mono text-[13px]"
            />
            {preview && !status?.signedIn && !preview.needs_sign_in && (
              <input
                aria-label={t.yourName}
                placeholder={t.yourName}
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                maxLength={120}
                className="h-9 rounded-[9px] border border-line-strong px-2.5 text-[14px]"
              />
            )}
            {preview && (
              <Button
                size="sm"
                disabled={busy !== null || (!status?.signedIn && !preview.needs_sign_in && joinName.trim() === '')}
                onClick={() =>
                  void run('join', async () => {
                    const joined = await joinTeam(joinLink.trim(), joinName.trim() || null)
                    setJoinLink('')
                    setPreview(null)
                    await loadTeams()
                    setTeamId(joined.workspace.id)
                  })
                }
              >
                {busy === 'join' ? t.joining : t.joinAs(preview.workspace.name, roleLabel(preview.role))}
              </Button>
            )}
          </div>
        </details>

        {state?.shared && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-danger"
            disabled={busy !== null}
            onClick={() => void run('stop', async () => onChanged(await stopSharingAgent(agent.id)))}
          >
            {t.stopSharing}
          </Button>
        )}
        {state?.message && <p className="m-0 text-[13px] text-amber-strong">{state.message}</p>}
        {error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
