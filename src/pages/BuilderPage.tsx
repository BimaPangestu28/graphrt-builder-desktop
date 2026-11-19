import { useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type { Agent } from '@/api/types'
import { AppShell, splitPaneMainClassName, type SidebarProps } from '@/components/layout'
import { useAgent } from '@/hooks/useAgent'
import { useFlowSummary } from '@/hooks/useFlowSummary'
import { setWorkflowSecret } from '@/api/credentials'
import { useProviderStatuses } from '@/hooks/useProviderStatuses'
import { useWorkflowSecrets } from '@/hooks/useWorkflowSecrets'
import { describeError } from '@/lib/agentDisplay'
import { sampleAgentId } from '@/routes'
import { BuilderAgentPanel } from './agent-builder/BuilderAgentPanel'
import { BuilderChatPanel } from './agent-builder/BuilderChatPanel'
import { listBuilderRequirements, listPluginSetupRequirements } from './agent-builder/builderRequirements'
import { focusPluginSetupMessage, PluginRequirementsMessage } from './agent-builder/PluginRequirementsMessage'
import { useAgentRevisions } from './agent-builder/useAgentRevisions'
import { useBuilderAskDraft } from './agent-builder/useBuilderAskDraft'
import { useBuilderHistory } from './agent-builder/useBuilderHistory'
import { usePluginSetup } from './agent-builder/usePluginSetup'
import { usePluginSetupPlacement } from './agent-builder/usePluginSetupPlacement'

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
 * Screen 04 · Builder for the agent in the `:agentId` route. Loads the agent, its flow
 * summary and the plugins it needs: chat on the left sends changes through `reviseAgent` (with Undo / Redo for the
 * last one, highlighting the steps it changed), and on the right the steps, the
 * connections and plugins it needs, and the History / Schedule / Test actions. Plugins are
 * approved, downloaded and set up in the chat (a card on open and after revisions that add
 * them); while they are not ready, Test brings that card up instead of starting. An `?ask=`
 * request ("Ask the builder to fix this step") is prefilled in the chat box, not sent.
 */
export function BuilderPage() {
  const agentId = useParams().agentId ?? sampleAgentId
  const agentState = useAgent(agentId)
  const flowSummaryState = useFlowSummary(agentId)
  const { data: providerSetup } = useProviderStatuses()
  const workflowSecretsState = useWorkflowSecrets(agentId)
  const reloadWorkflowSecrets = workflowSecretsState.reload
  const saveWorkflowSecret = useCallback(
    async (secretName: string, value: string) => {
      await setWorkflowSecret(secretName, value)
      await reloadWorkflowSecrets()
    },
    [reloadWorkflowSecrets],
  )
  const askDraft = useBuilderAskDraft()
  const pluginSetup = usePluginSetup(agentId)
  const pluginSetupPlacement = usePluginSetupPlacement(agentId, pluginSetup)
  const { placeAfterRevision, ensurePlaced } = pluginSetupPlacement
  const reloadPluginRequirements = pluginSetup.reload
  const pluginSetupMessageRef = useRef<HTMLDivElement>(null)
  const showPluginSetup = useCallback(() => {
    if (pluginSetupMessageRef.current) {
      focusPluginSetupMessage(pluginSetupMessageRef.current)
      return
    }
    // The card mounts on this click; focus it once it is in the chat.
    ensurePlaced()
    window.setTimeout(() => focusPluginSetupMessage(pluginSetupMessageRef.current), 0)
  }, [ensurePlaced])
  const reloadAgent = agentState.reload
  const reloadFlowSummary = flowSummaryState.reload
  // A revision may add or drop `env.*` values and plugin steps, so secrets and plugins reload with the steps.
  const reloadAgentAndSteps = useCallback(
    async (savedExchangeId: number | null) => {
      const reloadPlugins = savedExchangeId === null ? reloadPluginRequirements() : placeAfterRevision(savedExchangeId)
      await Promise.all([reloadAgent(), reloadFlowSummary(), reloadWorkflowSecrets(), reloadPlugins])
    },
    [reloadAgent, reloadFlowSummary, reloadWorkflowSecrets, reloadPluginRequirements, placeAfterRevision],
  )
  const builderHistory = useBuilderHistory(agentId)
  const revisions = useAgentRevisions({ agentId, currentVersion: agentState.data?.currentVersion ?? null, onAgentChanged: reloadAgentAndSteps })

  const agent = agentState.data
  const flowSummary = flowSummaryState.data
  const requirements = [
    ...listBuilderRequirements(agentId, flowSummary?.modelProviders ?? [], providerSetup?.statuses ?? null, workflowSecretsState.data),
    ...listPluginSetupRequirements(pluginSetup.requirements),
  ]

  return (
    <AppShell agents={getSidebarAgents(agentId, agent)} runnerStatus="Online · OpenAI connected" mainClassName={splitPaneMainClassName}>
      <BuilderChatPanel
        agent={agent}
        steps={flowSummary?.steps ?? []}
        openingExplanation={builderHistory.openingExplanation}
        savedMessages={builderHistory.laterMessages}
        exchanges={revisions.exchanges}
        latestRevision={revisions.latestRevision}
        isBusy={revisions.isBusy}
        undoErrorMessage={revisions.undoErrorMessage}
        onSubmitRequest={(request) => void revisions.sendChangeRequest(request)}
        onToggleUndo={() => void revisions.toggleUndo()}
        pluginSetupAnchor={pluginSetupPlacement.anchor}
        askDraft={askDraft}
        pluginSetupMessage={<PluginRequirementsMessage ref={pluginSetupMessageRef} setup={pluginSetup} />}
      />
      {agent ? (
        <BuilderAgentPanel
          agent={agent}
          flowSummary={flowSummary}
          flowSummaryError={flowSummaryState.error}
          highlightedStepIds={revisions.highlightedStepIds}
          requirements={requirements}
          onSaveSecret={saveWorkflowSecret}
          onShowPluginSetup={showPluginSetup}
          onPluginSessionChange={reloadPluginRequirements}
          arePluginsReady={pluginSetup.isReady !== false}
          onAgentRenamed={reloadAgent}
        />
      ) : (
        <AgentPanelMessage>{agentState.error ? `Could not load this agent: ${describeError(agentState.error)}` : 'Loading agent…'}</AgentPanelMessage>
      )}
    </AppShell>
  )
}
