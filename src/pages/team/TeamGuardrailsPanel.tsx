import { useState, type FormEvent } from 'react'
import type { TeamGuardrails } from '@/api/teamTypes'
import { messages } from '@/i18n'

const smallButtonClassNames = 'h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2 text-[12px] font-medium text-ink hover:bg-subtle'

interface AgentCallLimitProps {
  limit: number | null
  isSaving: boolean
  onSave: (limit: number | null) => void
}

/** "Agent calls per run": the value, and a small form to change or remove it. */
function AgentCallLimit({ limit, isSaving, onSave }: AgentCallLimitProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftLimit, setDraftLimit] = useState(limit === null ? '' : String(limit))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = draftLimit.trim()
    onSave(trimmed === '' ? null : Number(trimmed))
    setIsEditing(false)
  }
  if (!isEditing) {
    return (
      <span className="flex items-center justify-end gap-2">
        {limit === null ? messages().team.noLimit : messages().team.maxLimit(limit)}
        <button type="button" aria-label={messages().team.changeAgentCallsPerRun} className={smallButtonClassNames} onClick={() => setIsEditing(true)}>
          {messages().team.change}
        </button>
      </span>
    )
  }
  return (
    <form onSubmit={submit} className="flex items-center justify-end gap-1.5">
      <label className="sr-only" htmlFor="max-agent-calls">
        {messages().team.mostAgentCallsPerRunEmpty}
      </label>
      <input
        id="max-agent-calls"
        type="number"
        min={1}
        max={100}
        value={draftLimit}
        placeholder={messages().team.noLimit}
        onChange={(event) => setDraftLimit(event.target.value)}
        className="box-border h-7 w-20 rounded-md border border-line-strong px-2 text-[13px]"
      />
      <button type="submit" disabled={isSaving} className={smallButtonClassNames}>
        {messages().team.save}
      </button>
    </form>
  )
}

interface TeamGuardrailsPanelProps {
  guardrails: TeamGuardrails | null
  isSaving: boolean
  onSaveLimit: (limit: number | null) => void
}

/**
 * Screen 13 · guardrails that are enforced: the agent-call limit per run (the app refuses
 * calls beyond it), whether the team's steps ask before sending, and who adds members.
 */
export function TeamGuardrailsPanel({ guardrails, isSaving, onSaveLimit }: TeamGuardrailsPanelProps) {
  const sendingSteps = guardrails?.unapprovedSendingSteps ?? []
  return (
    <section aria-labelledby="team-guardrails-heading" className="flex min-w-0 flex-[2_1_240px] flex-col gap-3">
      <h2 id="team-guardrails-heading" className="m-0 text-[15px] font-semibold">
        {messages().team.guardrails}
      </h2>
      {guardrails && (
        <dl className="m-0 rounded-xl border border-line px-3.5 py-1">
          <div className="flex items-center justify-between gap-2 border-b border-chip py-2.5">
            <dt className="text-body">{messages().team.agentCallsPerRun}</dt>
            <dd className="m-0 text-right font-medium">
              <AgentCallLimit key={String(guardrails.maxAgentCallsPerRun)} limit={guardrails.maxAgentCallsPerRun} isSaving={isSaving} onSave={onSaveLimit} />
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-chip py-2.5">
            <dt className="text-body">{messages().team.sending}</dt>
            <dd className="m-0 text-right font-medium">{sendingSteps.length === 0 ? messages().team.alwaysAskMe : messages().team.sendsWithoutAskingValue(sendingSteps.join(', '))}</dd>
          </div>
          <div className="flex justify-between gap-2 py-2.5">
            <dt className="text-body">{messages().team.newMembers}</dt>
            <dd className="m-0 text-right font-medium">{messages().team.onlyYouAddThem}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}
