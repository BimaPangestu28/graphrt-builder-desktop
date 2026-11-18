import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { Agent } from '@/api/types'
import { AppShell, type SidebarProps } from '@/components/layout'
import { useAgent } from '@/hooks/useAgent'
import { useFlowSummary } from '@/hooks/useFlowSummary'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { describeError } from '@/lib/agentDisplay'
import { sampleAgentId } from '@/routes'
import { BuilderAgentPanel } from './agent-builder/BuilderAgentPanel'
import { BuilderChatPanel } from './agent-builder/BuilderChatPanel'
import { listBuilderRequirements } from './agent-builder/builderRequirements'
import { useAgentRevisions } from './agent-builder/useAgentRevisions'

const draftStatusLabels: Partial<Record<Agent['status'], string>> = {
  draft: 'Draft · not tested yet',
  tested: 'Tested · not scheduled yet',
}

/** Drafts and tested agents are highlighted on their own; active and paused ones show in the full list. */
function getSidebarAgents(agentId: string, agent: Agent | null): SidebarProps['agents'] {
  const draftStatus = agent ? draftStatusLabels[agent.status] : undefined
  if (agent && draftStatus) return { kind: 'draft', name: agent.name, status: draftStatus, agentId }
  return { kind: 'list', activeAgentId: agentId }
}

/** Shown in the agent column while the agent loads or when it cannot be read. */
function AgentPanelMessage({ children }: { children: string }) {
  return (
    <section aria-label="Agent" className="box-border flex min-w-0 flex-[1_1_440px] flex-col gap-2 bg-subtle p-6">
      <p className="m-0 text-muted">{children}</p>
    </section>
  )
}

/**
 * Screen 04 · Builder for the agent in the `:agentId` route. Loads the agent and its flow
 * summary: chat on the left sends changes through `reviseAgent` (with Undo / Redo for the
 * last one, highlighting the steps it changed), and on the right the steps, the
 * connections it needs, and the History / Schedule / Test actions.
 */
export function BuilderPage() {
  const agentId = useParams().agentId ?? sampleAgentId
  const agentState = useAgent(agentId)
  const flowSummaryState = useFlowSummary(agentId)
  const { data: providerSetup } = useProviderStatuses()
  const reloadAgent = agentState.reload
  const reloadFlowSummary = flowSummaryState.reload
  const reloadAgentAndSteps = useCallback(async () => {
    await Promise.all([reloadAgent(), reloadFlowSummary()])
  }, [reloadAgent, reloadFlowSummary])
  const revisions = useAgentRevisions({ agentId, currentVersion: agentState.data?.currentVersion ?? null, onAgentChanged: reloadAgentAndSteps })

  const agent = agentState.data
  const flowSummary = flowSummaryState.data
  const requirements = listBuilderRequirements(agentId, flowSummary?.modelProviders ?? [], providerSetup?.statuses ?? null)

  return (
    <AppShell agents={getSidebarAgents(agentId, agent)} runnerStatus="Online · OpenAI connected" mainClassName="flex flex-wrap">
      <BuilderChatPanel
        agent={agent}
        steps={flowSummary?.steps ?? []}
        modelName={providerSetup?.defaultModel.name ?? null}
        exchanges={revisions.exchanges}
        latestRevision={revisions.latestRevision}
        isBusy={revisions.isBusy}
        undoErrorMessage={revisions.undoErrorMessage}
        onSubmitRequest={(request) => void revisions.sendChangeRequest(request)}
        onToggleUndo={() => void revisions.toggleUndo()}
      />
      {agent ? (
        <BuilderAgentPanel
          agent={agent}
          flowSummary={flowSummary}
          flowSummaryError={flowSummaryState.error}
          highlightedStepIds={revisions.highlightedStepIds}
          requirements={requirements}
        />
      ) : (
        <AgentPanelMessage>{agentState.error ? `Could not load this agent: ${describeError(agentState.error)}` : 'Loading agent…'}</AgentPanelMessage>
      )}
    </AppShell>
  )
}
