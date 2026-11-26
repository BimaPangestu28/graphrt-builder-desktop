import { Link } from 'react-router-dom'
import { Icon, StrokeIcon, joinClassNames } from '@/components/ui'
import type { AgentStepInfo } from '@/api/chainTypes'
import { routePaths } from '@/routes'
import { messages } from '@/i18n'

/**
 * Agents in the catalog whose name or description matches the search text (case-insensitive).
 *
 * @param agents - Catalog entries (AgentStepInfo[])
 * @param searchText - What the user typed (string)
 * @returns The matching entries, in catalog order (AgentStepInfo[])
 */
export function filterAgentCatalog(agents: AgentStepInfo[], searchText: string): AgentStepInfo[] {
  const normalizedSearch = searchText.trim().toLowerCase()
  if (!normalizedSearch) return agents
  return agents.filter((agent) => `${agent.name} ${agent.description}`.toLowerCase().includes(normalizedSearch))
}

/** "In place · Out score, reason" */
function describeSignature(agent: AgentStepInfo): string {
  const parts = []
  if (agent.inputs.length > 0) parts.push(messages().team.inputsList(agent.inputs.map((input) => input.name).join(', ')))
  if (agent.outputs.length > 0) parts.push(messages().team.outValue(agent.outputs.join(', ')))
  if (agent.usedByCount > 0) parts.push(messages().team.usedInAgents(agent.usedByCount))
  return parts.join(' · ')
}

interface CatalogItemCardProps {
  agent: AgentStepInfo
  isAdded: boolean
  isAdding: boolean
  onAdd: (agentId: string) => void
}

function CatalogItemAction({ agent, isAdded, isAdding, onAdd }: CatalogItemCardProps) {
  if (isAdded) return <span className="text-[12px] font-medium text-ok-strong">{messages().team.added}</span>
  if (!agent.usableAsStep) return <span className="text-[12px] text-muted">{messages().team.cantRunAsAStep}</span>
  return (
    <button
      type="button"
      aria-label={messages().team.addName(agent.name)}
      disabled={isAdding}
      onClick={() => onAdd(agent.agentId)}
      className="h-[30px] cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:text-muted"
    >
      {messages().team.add}
    </button>
  )
}

function CatalogItemCard(props: CatalogItemCardProps) {
  const { agent, isAdded } = props
  return (
    <div className={joinClassNames('flex flex-col gap-2 rounded-xl bg-surface p-3.5', isAdded ? 'border-2 border-ink' : 'border border-line')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{agent.name}</span>
        <CatalogItemAction {...props} />
      </div>
      {agent.description && <span className="leading-normal text-body">{agent.description}</span>}
      <span className="text-[12px] text-muted">{agent.usableAsStep ? describeSignature(agent) : agent.unusableReason}</span>
    </div>
  )
}

interface AddStepPanelProps {
  searchText: string
  onSearchTextChange: (searchText: string) => void
  visibleAgents: AgentStepInfo[]
  addedAgentId: string | undefined
  isAdding: boolean
  onAddAgent: (agentId: string) => void
}

/** Right panel of screen 12: search and the catalog of your agents with Add buttons. */
export function AddStepPanel({ searchText, onSearchTextChange, visibleAgents, addedAgentId, isAdding, onAddAgent }: AddStepPanelProps) {
  return (
    <aside aria-labelledby="add-step-heading" className="box-border flex min-w-0 flex-[1_1_360px] flex-col gap-4 border-l border-line bg-subtle p-6">
      <div className="flex items-center justify-between">
        <h2 id="add-step-heading" className="m-0 text-[18px] font-semibold">
          {messages().team.addOneOfYourAgents}
        </h2>
        <Link to={routePaths.chain} aria-label={messages().team.close} className="flex size-8 items-center justify-center rounded-lg !text-ink-2 hover:bg-chip">
          <Icon name="close" size={16} />
        </Link>
      </div>
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3">
        <StrokeIcon size={15} className="shrink-0 text-muted">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </StrokeIcon>
        <input
          type="search"
          aria-label={messages().team.searchAgents}
          placeholder={messages().team.searchYourAgents}
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          className="min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
        />
      </label>
      <div aria-label={messages().team.myAgents} role="list" className="flex flex-col gap-2">
        {visibleAgents.length === 0 && <p className="m-0 text-[13px] text-muted">{searchText ? messages().team.nothingMatchesSearchtext(searchText) : messages().team.noOtherAgentsYet}</p>}
        {visibleAgents.map((agent) => (
          <div role="listitem" key={agent.agentId}>
            <CatalogItemCard agent={agent} isAdded={agent.agentId === addedAgentId} isAdding={isAdding} onAdd={onAddAgent} />
          </div>
        ))}
      </div>
      <p className="m-0 text-[13px] leading-normal text-body">
        {messages().team.anAgentWorksAsAStep}
      </p>
    </aside>
  )
}
