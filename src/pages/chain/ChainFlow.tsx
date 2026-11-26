import { useState } from 'react'
import { Icon, joinClassNames } from '@/components/ui'
import type { AgentStepInfo, ChainStep } from '@/api/chainTypes'
import { describeChainLink } from './chainEditing'
import { messages } from '@/i18n'

const monospaceChipClassNames = 'rounded-md bg-canvas px-2 py-[3px] font-mono'

function VerticalConnector({ heightClassName, isHighlighted = false }: { heightClassName: string; isHighlighted?: boolean }) {
  return <span aria-hidden="true" className={joinClassNames('w-0.5 self-center', heightClassName, isHighlighted ? 'bg-brand' : 'bg-line-strong')} />
}

interface ChainAgentCardProps {
  agent: AgentStepInfo | undefined
  agentId: string
  position: number
  onRemove: () => void
}

function ChainAgentCard({ agent, agentId, position, onRemove }: ChainAgentCardProps) {
  const agentName = agent?.name ?? agentId
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4">
      <div className="flex items-center gap-2.5">
        <span className="text-[12px] font-semibold text-muted">{position}</span>
        <span className="flex-auto font-semibold">{agentName}</span>
        {agent && <span className="text-[12px] text-muted">{agent.stepCount} {messages().team.steps2}</span>}
        <button
          type="button"
          aria-label={messages().team.removeAgentname(agentName)}
          onClick={onRemove}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-subtle hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {agent?.description && <span className="text-body">{agent.description}</span>}
      {agent && agent.outputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <span className="py-[3px] text-muted">{messages().team.gives}</span>
          {agent.outputs.map((output) => (
            <span key={output} className={monospaceChipClassNames}>
              {output}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface ChainLinkButtonProps {
  step: ChainStep
  isSelected: boolean
  onSelect: () => void
}

function ChainLinkButton({ step, isSelected, onSelect }: ChainLinkButtonProps) {
  return (
    <div className="flex flex-col items-center self-center">
      <VerticalConnector heightClassName="h-4" isHighlighted={isSelected} />
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onSelect}
        className={joinClassNames(
          'h-8 cursor-pointer rounded-full bg-surface px-3 text-[12px] font-medium',
          isSelected ? 'border-2 border-brand text-brand-strong' : 'border border-line-strong text-ink-2 hover:bg-subtle',
        )}
      >
        {describeChainLink(step)}
      </button>
      <VerticalConnector heightClassName="h-4" isHighlighted={isSelected} />
    </div>
  )
}

interface AddAgentControlProps {
  agents: AgentStepInfo[]
  lastAgentId: string | undefined
  onAddAgent: (agentId: string) => void
}

/** Picks an agent to run after the last one. */
function AddAgentControl({ agents, lastAgentId, onAddAgent }: AddAgentControlProps) {
  const candidates = agents.filter((agent) => agent.agentId !== lastAgentId)
  const [chosenAgentId, setChosenAgentId] = useState('')
  const selectedAgentId = candidates.some((agent) => agent.agentId === chosenAgentId) ? chosenAgentId : (candidates[0]?.agentId ?? '')
  if (candidates.length === 0) return <p className="m-0 self-center text-[13px] text-muted">{messages().team.buildAnotherAgentToAddIt}</p>
  return (
    <div className="flex flex-wrap items-center gap-2 self-center">
      <select
        aria-label={messages().team.agentToAdd}
        value={selectedAgentId}
        onChange={(event) => setChosenAgentId(event.target.value)}
        className="h-10 max-w-[260px] rounded-[10px] border border-line-strong bg-surface px-2.5 text-[14px] text-ink"
      >
        {candidates.map((agent) => (
          <option key={agent.agentId} value={agent.agentId}>
            {agent.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onAddAgent(selectedAgentId)}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-line-heavy bg-surface px-4 font-medium text-ink-2 hover:bg-subtle"
      >
        <Icon name="plus" size={15} />
        {messages().team.addAgent}
      </button>
    </div>
  )
}

interface ChainFlowProps {
  steps: ChainStep[]
  agents: AgentStepInfo[]
  selectedPosition: number
  onSelectLink: (position: number) => void
  onAddAgent: (agentId: string) => void
  onRemoveAgent: (position: number) => void
}

/** The chain drawn top to bottom: what starts it, agent cards, and clickable links between them. */
export function ChainFlow({ steps, agents, selectedPosition, onSelectLink, onAddAgent, onRemoveAgent }: ChainFlowProps) {
  const findAgent = (agentId: string) => agents.find((agent) => agent.agentId === agentId)
  const firstAgentName = steps[0] ? (findAgent(steps[0].agentId)?.name ?? steps[0].agentId) : null
  return (
    <section aria-label={messages().team.chain} className="box-border flex min-w-0 flex-[2_1_480px] flex-col items-center bg-subtle p-8">
      <div className="flex w-full max-w-[520px] flex-col items-stretch">
        <div className="flex h-9 items-center gap-2 self-center rounded-full border border-line bg-surface px-3.5 font-medium">
          <Icon name="clock" size={15} />
          {firstAgentName ? messages().team.startsWhenFirstagentnameRuns(firstAgentName) : messages().team.addTheAgentThatStartsThe}
        </div>
        <VerticalConnector heightClassName="h-6" />
        {steps.map((step, position) => (
          <div key={`${position}-${step.agentId}`} className="contents">
            {position > 0 && <ChainLinkButton step={step} isSelected={position === selectedPosition} onSelect={() => onSelectLink(position)} />}
            <ChainAgentCard agent={findAgent(step.agentId)} agentId={step.agentId} position={position + 1} onRemove={() => onRemoveAgent(position)} />
          </div>
        ))}
        {steps.length > 0 && <VerticalConnector heightClassName="h-5" />}
        <AddAgentControl agents={agents} lastAgentId={steps[steps.length - 1]?.agentId} onAddAgent={onAddAgent} />
      </div>
    </section>
  )
}
