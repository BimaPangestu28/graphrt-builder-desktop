import { Link } from 'react-router-dom'
import { Icon, joinClassNames } from '@/components/ui'
import { chainTriggerLabel, describeChainLink, type ChainAgent, type ChainLink } from '@/data/chain'
import { routePaths } from '@/routes'

const monospaceChipClassNames = 'rounded-md bg-canvas px-2 py-[3px] font-mono'

function VerticalConnector({ heightClassName, isHighlighted = false }: { heightClassName: string; isHighlighted?: boolean }) {
  return <span aria-hidden="true" className={joinClassNames('w-0.5 self-center', heightClassName, isHighlighted ? 'bg-brand' : 'bg-line-strong')} />
}

function ChainAgentCard({ agent, position }: { agent: ChainAgent; position: number }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4">
      <div className="flex items-center gap-2.5">
        <span className="text-[12px] font-semibold text-muted">{position}</span>
        <span className="flex-auto font-semibold">{agent.name}</span>
        <span className="text-[12px] text-muted">{agent.stepCount} steps</span>
      </div>
      {agent.description && <span className="text-body">{agent.description}</span>}
      {agent.outputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <span className="py-[3px] text-muted">Gives</span>
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
  link: ChainLink
  isSelected: boolean
  onSelect: (linkId: string) => void
}

function ChainLinkButton({ link, isSelected, onSelect }: ChainLinkButtonProps) {
  return (
    <div className="flex flex-col items-center self-center">
      <VerticalConnector heightClassName="h-4" isHighlighted={isSelected} />
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(link.id)}
        className={joinClassNames(
          'h-8 cursor-pointer rounded-full bg-surface px-3 text-[12px] font-medium',
          isSelected ? 'border-2 border-brand text-brand-strong' : 'border border-line-strong text-ink-2 hover:bg-subtle',
        )}
      >
        {describeChainLink(link)}
      </button>
      <VerticalConnector heightClassName="h-4" isHighlighted={isSelected} />
    </div>
  )
}

interface ChainFlowProps {
  agents: ChainAgent[]
  links: ChainLink[]
  selectedLinkId: string
  onSelectLink: (linkId: string) => void
}

/** The chain drawn top to bottom: trigger pill, agent cards, and clickable links between them. */
export function ChainFlow({ agents, links, selectedLinkId, onSelectLink }: ChainFlowProps) {
  return (
    <section aria-label="Chain" className="box-border flex min-w-0 flex-[2_1_480px] flex-col items-center bg-subtle p-8">
      <div className="flex w-full max-w-[520px] flex-col items-stretch">
        <div className="flex h-9 items-center gap-2 self-center rounded-full border border-line bg-surface px-3.5 font-medium">
          <Icon name="clock" size={15} />
          {chainTriggerLabel}
        </div>
        <VerticalConnector heightClassName="h-6" />
        {agents.map((agent, agentIndex) => {
          const outgoingLink = links.find((link) => link.fromIndex === agentIndex)
          return (
            <div key={agent.id} className="contents">
              <ChainAgentCard agent={agent} position={agentIndex + 1} />
              {outgoingLink && <ChainLinkButton link={outgoingLink} isSelected={outgoingLink.id === selectedLinkId} onSelect={onSelectLink} />}
            </div>
          )
        })}
        <VerticalConnector heightClassName="h-5" />
        <Link
          to={routePaths.agentAsStep}
          className="flex h-10 items-center gap-2 self-center rounded-[10px] border border-dashed border-line-heavy bg-surface px-4 font-medium no-underline !text-ink-2 hover:bg-subtle"
        >
          <Icon name="plus" size={15} />
          Add agent
        </Link>
      </div>
    </section>
  )
}
