import { useState } from 'react'
import { isBackendErrorWithCode } from '@/api/client'
import { listAgentSkills, setAgentStepSkills } from '@/api/skills'
import type { AgentSkills } from '@/api/skillTypes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'

interface AgentSkillPickerProps {
  /** Technical name of the skill being given to agents. */
  skillName: string
  /** Called after an agent was changed, so the caller can refresh its own counts. */
  onChanged?: () => void
}

interface RowError {
  key: string
  message: string
}

/**
 * "Where to use it": every agent (and step, when an agent has several) that can use skills,
 * with a checkbox. Ticking saves at once, as a new version of that agent, so nobody edits an
 * agent's steps by hand. Agents that cannot use skills as built are listed below with what
 * to ask the builder.
 */
export function AgentSkillPicker({ skillName, onChanged }: AgentSkillPickerProps) {
  const t = useT().skills.agents
  const loaded = useAsyncData(listAgentSkills, [])
  const [changedAgents, setChangedAgents] = useState<Record<string, AgentSkills>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<RowError | null>(null)

  if (loaded.error) {
    return (
      <p role="alert" className="m-0 text-[13px] text-danger">
        {t.couldNotLoad(describeError(loaded.error))}
      </p>
    )
  }
  if (!loaded.data) return <p className="m-0 text-muted">{t.loading}</p>

  const agents = loaded.data.map((agent) => changedAgents[agent.agentId] ?? agent)
  const usable = agents.filter((agent) => agent.steps.length > 0)
  const unusable = agents.filter((agent) => agent.steps.length === 0)
  if (agents.length === 0) return <p className="m-0 text-body">{t.noAgents}</p>

  async function toggle(agent: AgentSkills, stepId: string, isUsed: boolean) {
    const step = agent.steps.find((candidate) => candidate.stepId === stepId)
    if (!step) return
    const key = `${agent.agentId}/${stepId}`
    const nextSkills = isUsed ? [...step.skills.filter((skill) => skill !== skillName), skillName] : step.skills.filter((skill) => skill !== skillName)
    setSavingKey(key)
    setRowError(null)
    try {
      const saved = await setAgentStepSkills(agent.agentId, stepId, nextSkills)
      setChangedAgents((current) => ({ ...current, [saved.agentId]: saved }))
      onChanged?.()
    } catch (error) {
      const message = isBackendErrorWithCode(error, 'builder_busy') ? t.builderBusy(agent.agentName) : t.couldNotSave(agent.agentName, describeError(error))
      setRowError({ key, message })
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {usable.length > 0 && (
        <ul aria-label={t.listLabel} className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {usable.flatMap((agent) =>
            agent.steps.map((step) => {
              const key = `${agent.agentId}/${step.stepId}`
              const label = agent.steps.length > 1 ? t.agentStep(agent.agentName, step.title) : agent.agentName
              const isUsed = step.skills.includes(skillName)
              return (
                <li key={key} className={`flex flex-col gap-1 rounded-[12px] border px-4 py-3 ${isUsed ? 'border-ink' : 'border-line'} bg-surface`}>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={isUsed}
                      disabled={savingKey !== null}
                      onChange={(event) => void toggle(agent, step.stepId, event.target.checked)}
                      className="size-4 shrink-0 accent-ink"
                    />
                    <span className="min-w-0 truncate" title={label}>
                      {label}
                    </span>
                  </label>
                  {savingKey === key && <span className="pl-[26px] text-[12px] text-muted">{t.saving}</span>}
                  {rowError?.key === key && (
                    <span role="alert" className="pl-[26px] text-[12px] leading-normal text-danger">
                      {rowError.message}
                    </span>
                  )}
                </li>
              )
            }),
          )}
        </ul>
      )}
      {unusable.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[12px] bg-subtle px-4 py-3">
          <span className="text-[13px] font-semibold text-ink-2">{t.cannotUseHeading}</span>
          <span className="text-[13px] text-body">{unusable.map((agent) => agent.agentName).join(', ')}</span>
          <span className="text-[12px] text-muted">{t.cannotUseHint}</span>
        </div>
      )}
    </div>
  )
}
