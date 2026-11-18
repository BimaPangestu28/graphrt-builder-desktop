import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { chainAgents, chainName, initialChainLinks, type ChainLink } from '@/data/chain'
import { routePaths } from '@/routes'
import { ChainFlow } from './chain/ChainFlow'
import { LinkSettingsPanel } from './chain/LinkSettingsPanel'

const headerButtonClassNames = 'flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium no-underline'

interface ChainHeaderProps {
  isActive: boolean
  onToggleActive: () => void
}

/** Breadcrumb with the chain's status, plus Test chain and Activate / Pause actions. */
function ChainHeader({ isActive, onToggleActive }: ChainHeaderProps) {
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2 text-muted">
        <Link to={routePaths.home} className="no-underline !text-muted hover:!text-ink">
          Chains
        </Link>
        <span aria-hidden="true">/</span>
        <h1 className="m-0 text-[14px] font-semibold text-ink">{chainName}</h1>
        <span className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isActive ? 'bg-ok-soft text-ok-strong' : 'bg-selected text-ink-2')}>
          {isActive ? 'Active' : 'Draft'}
        </span>
      </div>
      <div className="flex gap-2">
        <Link to={routePaths.testRun} className={`${headerButtonClassNames} border border-line-strong bg-surface !text-ink hover:bg-subtle`}>
          Test chain
        </Link>
        <button type="button" onClick={onToggleActive} className={`${headerButtonClassNames} cursor-pointer border-0 bg-ink text-white hover:bg-ink-2`}>
          {isActive ? 'Pause' : 'Activate'}
        </button>
      </div>
    </header>
  )
}

/**
 * Screen 11 · Chain agents.
 * Builds a chain where each agent runs after the previous one, passing its outputs along.
 * Clicking a link between two agents opens its settings on the right; edits update the link label live.
 */
export function ChainPage() {
  const [links, setLinks] = useState<ChainLink[]>(initialChainLinks)
  const [selectedLinkId, setSelectedLinkId] = useState(initialChainLinks[0].id)
  const [isActive, setIsActive] = useState(false)

  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0]
  const targetAgent = chainAgents[selectedLink.fromIndex + 1]
  const updateSelectedLink = (updatedLink: ChainLink) => setLinks((current) => current.map((link) => (link.id === updatedLink.id ? updatedLink : link)))

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'leads-recap' }} mainClassName="flex flex-col">
      <ChainHeader isActive={isActive} onToggleActive={() => setIsActive((current) => !current)} />
      <div className="flex flex-auto flex-wrap">
        <ChainFlow agents={chainAgents} links={links} selectedLinkId={selectedLink.id} onSelectLink={setSelectedLinkId} />
        <LinkSettingsPanel link={selectedLink} linkNumber={selectedLink.fromIndex + 1} targetAgentName={targetAgent.name} onChange={updateSelectedLink} />
      </div>
    </AppShell>
  )
}
