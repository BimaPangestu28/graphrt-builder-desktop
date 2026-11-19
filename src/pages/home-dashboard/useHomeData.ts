import { listConnectionReminders } from '@/api/connectionReminders'
import type { ConnectionReminder } from '@/api/connectionReminderTypes'
import type { Conversation } from '@/api/conversationTypes'
import { listProviderStatuses } from '@/api/credentials'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { listAgentPluginRequirements } from '@/api/plugins'
import { listProblems } from '@/api/problems'
import type { Problem } from '@/api/problemTypes'
import { listAgentRunStats } from '@/api/runSummary'
import type { AgentRunStats } from '@/api/runSummaryTypes'
import type { Agent, ProviderStatus, Run, Trigger } from '@/api/types'
import { getUsageSummary } from '@/api/usageSummary'
import type { UsageSummary } from '@/api/usageSummaryTypes'
import { useAgents } from '@/hooks/useAgents'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useConversationList } from '@/hooks/useConversations'
import { useLoadedData, useRunEventSubscription } from '@/hooks/useRunData'
import { useRuns } from '@/hooks/useRuns'
import { useTriggers } from '@/hooks/useTriggers'
import { startOfLocalMonth } from './monthlyUsage'

/** Everything the Home screen (09) reads from the backend, in one hook. */

/**
 * Runs Home looks at: enough for the latest run of every agent, every paused run and this
 * month's numbers (the backend caps a list at 1000).
 */
export const homeRunListLimit = 500

export interface HomeData {
  agents: Agent[] | null
  agentsError: Error | null
  /** Newest first; null while loading. */
  runs: Run[] | null
  runsError: Error | null
  runStats: AgentRunStats[] | null
  waitingChats: Conversation[] | null
  connectionReminders: ConnectionReminder[] | null
  problems: Problem[] | null
  /** Agent id → its plugin requirements; agents whose requirements could not be read are absent. */
  pluginRequirements: Map<string, PluginRequirement[]>
  providerStatuses: ProviderStatus[] | null
  triggers: Trigger[]
  areTriggersLoading: boolean
  triggersError: Error | null
  monthlyUsage: UsageSummary | null
  monthlyUsageError: Error | null
}

/** Calls `reload` whenever a run changes status (finished, paused or failed). */
function useReloadOnRunStatusChange(reload: () => void) {
  useRunEventSubscription((payload) => {
    if (payload.event.type === 'status_changed') reload()
  })
}

/** Loads with `loadData` and reloads whenever a run changes status. */
function useRunAwareData<Data>(loadData: () => Promise<Data>, dependencies: unknown[] = []) {
  const loaded = useLoadedData(loadData, dependencies)
  useReloadOnRunStatusChange(loaded.reload)
  return loaded
}

/**
 * Each agent's plugin requirements. An agent whose requirements cannot be read (older backend,
 * broken workflow) is left out instead of failing the whole Home screen.
 */
async function loadPluginRequirements(agentIds: string[]): Promise<Map<string, PluginRequirement[]>> {
  const entries = await Promise.all(
    agentIds.map(async (agentId) => {
      try {
        return [[agentId, await listAgentPluginRequirements(agentId)] as const]
      } catch {
        return []
      }
    }),
  )
  return new Map(entries.flat())
}

const emptyRequirements = new Map<string, PluginRequirement[]>()

/**
 * Agents, runs, chats, problems, plugin requirements, providers, triggers and this month's
 * usage for Home; run-dependent parts reload when a run changes status.
 *
 * @returns The data and load errors (HomeData)
 */
export function useHomeData(): HomeData {
  const { data: agents, error: agentsError } = useAgents()
  const { data: runs, error: runsError } = useRuns({ limit: homeRunListLimit })
  const { data: runStats } = useRunAwareData(() => listAgentRunStats())
  const { data: waitingChats } = useConversationList({ status: 'waiting_for_you' })
  const { data: connectionReminders } = useAsyncData(listConnectionReminders, [])
  const { data: problems } = useRunAwareData(listProblems)
  const agentIdsKey = (agents ?? []).map((agent) => agent.id).join(',')
  const { data: pluginRequirements } = useRunAwareData(() => loadPluginRequirements(agentIdsKey ? agentIdsKey.split(',') : []), [agentIdsKey])
  const { data: providerStatuses } = useAsyncData(listProviderStatuses, [])
  const { triggers, isLoading: areTriggersLoading, error: triggersError } = useTriggers()
  const { data: monthlyUsage, error: monthlyUsageError } = useRunAwareData(() => getUsageSummary(startOfLocalMonth(new Date()).toISOString()))
  return {
    agents,
    agentsError,
    runs,
    runsError,
    runStats,
    waitingChats,
    connectionReminders,
    problems,
    pluginRequirements: pluginRequirements ?? emptyRequirements,
    providerStatuses,
    triggers,
    areTriggersLoading,
    triggersError,
    monthlyUsage,
    monthlyUsageError,
  }
}
