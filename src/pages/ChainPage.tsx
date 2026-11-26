import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { createChain, listAgentSteps, listChains } from '@/api/chains'
import type { AgentStepInfo, Chain } from '@/api/chainTypes'
import { useAsyncData } from '@/hooks/useAsyncData'
import { ChainEditor } from './chain/ChainEditor'
import { messages } from '@/i18n'

interface ChainScreenData {
  chains: Chain[]
  agents: AgentStepInfo[]
}

async function loadChainScreen(): Promise<ChainScreenData> {
  const [chains, agents] = await Promise.all([listChains(), listAgentSteps()])
  return { chains, agents }
}

function EmptyChains({ onCreate, isCreating }: { onCreate: () => void; isCreating: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 p-8">
      <h1 className="m-0 text-[22px] font-semibold">{messages().team.chains}</h1>
      <p className="m-0 max-w-[460px] leading-normal text-body">{messages().team.aChainStartsTheNextAgent}</p>
      <button type="button" disabled={isCreating} onClick={onCreate} className="h-10 cursor-pointer rounded-[10px] border-0 bg-ink px-4 font-medium text-white hover:bg-ink-2">
        {messages().team.newChain}
      </button>
    </div>
  )
}

/**
 * Screen 11 · Chain agents.
 * Shows the chain named by `?chainId=` (or the first one): each agent runs after the previous one,
 * passing its outputs along. Clicking a link opens its settings on the right.
 */
export function ChainPage() {
  const [searchParams] = useSearchParams()
  const requestedChainId = searchParams.get('chainId')
  const { data, error, isLoading, reload } = useAsyncData(loadChainScreen, [])
  const [isCreating, setIsCreating] = useState(false)

  const chain = data ? (data.chains.find((candidate) => candidate.id === requestedChainId) ?? data.chains[0]) : undefined

  const createFirstChain = async () => {
    setIsCreating(true)
    try {
      await createChain({ name: 'New chain', steps: [] })
      await reload()
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'leads-recap' }} mainClassName="flex flex-col">
      {isLoading && !data && <p className="m-0 p-8 text-muted">{messages().team.loadingTheChain}</p>}
      {error && (
        <p role="alert" className="m-0 p-8 text-amber-strong">
          {messages().team.couldNotLoadTheChain}{' '}{error.message}
        </p>
      )}
      {data && !chain && <EmptyChains onCreate={() => void createFirstChain()} isCreating={isCreating} />}
      {data && chain && <ChainEditor key={chain.id} initialChain={chain} agents={data.agents} />}
    </AppShell>
  )
}
