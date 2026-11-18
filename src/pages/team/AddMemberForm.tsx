import { useState, type FormEvent } from 'react'
import type { AgentStepInfo } from '@/api/chainTypes'

interface AddMemberFormProps {
  candidates: AgentStepInfo[]
  isAdding: boolean
  onAdd: (agentId: string) => void
  onCancel: () => void
}

/** Picks one of your agents to give the coordinator as a new member. */
export function AddMemberForm({ candidates, isAdding, onAdd, onCancel }: AddMemberFormProps) {
  const [chosenAgentId, setChosenAgentId] = useState(candidates[0]?.agentId ?? '')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (chosenAgentId) onAdd(chosenAgentId)
  }
  if (candidates.length === 0) {
    return <p className="m-0 text-[13px] text-muted">Every agent that can run as a step is already in the team</p>
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
      <label className="flex flex-auto flex-wrap items-center gap-2 text-[13px] text-ink-2">
        New member
        <select
          value={chosenAgentId}
          onChange={(event) => setChosenAgentId(event.target.value)}
          className="h-9 min-w-0 flex-auto rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
        >
          {candidates.map((agent) => (
            <option key={agent.agentId} value={agent.agentId}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={isAdding} className="h-9 cursor-pointer rounded-lg border-0 bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-2">
        {isAdding ? 'Adding…' : 'Add to team'}
      </button>
      <button type="button" onClick={onCancel} className="h-9 cursor-pointer rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-subtle">
        Cancel
      </button>
    </form>
  )
}
