import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { getAgent } from '@/api/agents'
import { getFlowSummary } from '@/api/builder'
import { addAgentStep, listAgentSteps } from '@/api/chains'
import type { AgentStepInfo } from '@/api/chainTypes'
import type { Agent, FlowStep } from '@/api/types'
import { useAsyncData } from '@/hooks/useAsyncData'
import { sampleAgentId } from '@/routes'
import { AddStepPanel, filterAgentCatalog } from './agent-as-step/AddStepPanel'
import { AgentStepList } from './agent-as-step/AgentStepList'

interface AgentAsStepData {
  agent: Agent
  steps: FlowStep[]
  catalog: AgentStepInfo[]
}

async function loadAgentAsStep(agentId: string): Promise<AgentAsStepData> {
  const [agent, summary, catalog] = await Promise.all([getAgent(agentId), getFlowSummary(agentId), listAgentSteps()])
  return { agent, steps: summary.steps, catalog }
}

/** Default place for a new step: the last top-level step before the first loop, else the last step. */
function pickDefaultPlacement(steps: FlowStep[]): string {
  const loopIndex = steps.findIndex((flowStep) => flowStep.nodeType === 'iteration' || flowStep.nodeType === 'loop')
  const anchor = loopIndex > 0 ? steps[loopIndex - 1] : steps[steps.length - 1]
  return anchor?.id ?? ''
}

type AddOutcome = { kind: 'added'; agentId: string; summary: string; changedStepIds: string[] } | { kind: 'error'; message: string } | null

/**
 * Screen 12 · Agent as a step.
 * Adds one of your agents as a step of the agent named by `?agentId=` (the sample agent otherwise).
 * "Add" asks the builder to insert a `tool` step that runs that agent, saved as a new version.
 */
export function AgentAsStepPage() {
  const [searchParams] = useSearchParams()
  const agentId = searchParams.get('agentId') ?? sampleAgentId
  const { data, error, reload } = useAsyncData(() => loadAgentAsStep(agentId), [agentId])
  const [searchText, setSearchText] = useState('')
  const [chosenPlacementId, setChosenPlacementId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [addOutcome, setAddOutcome] = useState<AddOutcome>(null)

  if (error) {
    return (
      <AppShell agents={{ kind: 'list' }} mainClassName="p-8">
        <p role="alert" className="m-0 text-amber-strong">
          Could not load the agent: {error.message}
        </p>
      </AppShell>
    )
  }
  if (!data) {
    return (
      <AppShell agents={{ kind: 'list' }} mainClassName="p-8">
        <p className="m-0 text-muted">Loading the steps…</p>
      </AppShell>
    )
  }

  const placementStepId = chosenPlacementId ?? pickDefaultPlacement(data.steps)
  const placementTitle = data.steps.find((flowStep) => flowStep.id === placementStepId)?.title
  const otherAgents = data.catalog.filter((agent) => agent.agentId !== agentId)

  const addStep = async (stepAgentId: string) => {
    setIsAdding(true)
    setAddOutcome(null)
    try {
      const revision = await addAgentStep({ targetAgentId: agentId, stepAgentId, placement: placementTitle ? `after the step "${placementTitle}"` : null }, () => {})
      setAddOutcome({ kind: 'added', agentId: stepAgentId, summary: revision.summary, changedStepIds: revision.changedStepIds })
      await reload()
    } catch (rawError) {
      setAddOutcome({ kind: 'error', message: rawError instanceof Error ? rawError.message : 'Could not add the step' })
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <AppShell agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <div className="flex min-w-0 flex-[2_1_480px] flex-col">
        {addOutcome?.kind === 'added' && (
          <p role="status" className="m-0 mx-8 mt-6 rounded-[10px] bg-subtle px-3.5 py-2.5 text-[13px]">
            {addOutcome.summary}
          </p>
        )}
        {addOutcome?.kind === 'error' && (
          <p role="alert" className="m-0 mx-8 mt-6 rounded-[10px] bg-amber-tint px-3.5 py-2.5 text-[13px] text-amber-strong">
            {addOutcome.message}
          </p>
        )}
        <AgentStepList
          agentName={data.agent.name}
          steps={data.steps}
          catalog={data.catalog}
          changedStepIds={addOutcome?.kind === 'added' ? addOutcome.changedStepIds : []}
          placementStepId={placementStepId}
          onPlacementChange={setChosenPlacementId}
        />
      </div>
      <AddStepPanel
        searchText={searchText}
        onSearchTextChange={setSearchText}
        visibleAgents={filterAgentCatalog(otherAgents, searchText)}
        addedAgentId={addOutcome?.kind === 'added' ? addOutcome.agentId : undefined}
        isAdding={isAdding}
        onAddAgent={(stepAgentId) => void addStep(stepAgentId)}
      />
    </AppShell>
  )
}
