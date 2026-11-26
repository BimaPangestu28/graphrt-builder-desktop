import { callBackend, isDesktopApp } from './client'
import type { AvailablePluginTrigger, TriggerRef } from './pluginTriggerTypes'

/**
 * Plugin triggers: events from installed plugins that start agents ("When a meeting is recorded").
 * The app watches them in the background while an agent uses one. Outside the desktop app there are
 * none.
 */

function hasBackend(): boolean {
  return !(__SAMPLE_BACKEND__ && !isDesktopApp())
}

/** Every trigger of the installed plugins. */
export function listPluginTriggers(): Promise<AvailablePluginTrigger[]> {
  if (!hasBackend()) return Promise.resolve([])
  return callBackend('list_plugin_triggers')
}

/** The agent's plugin trigger, or null. */
export function getAgentPluginTrigger(agentId: string): Promise<TriggerRef | null> {
  if (!hasBackend()) return Promise.resolve(null)
  return callBackend('get_agent_plugin_trigger', { agentId })
}

/**
 * Sets (or with null clears) the agent's plugin trigger; setting one activates the agent.
 *
 * @throws BackendError - `invalid_input` for a trigger no installed plugin declares
 */
export function setAgentPluginTrigger(agentId: string, trigger: TriggerRef | null): Promise<TriggerRef | null> {
  if (!hasBackend()) return Promise.resolve(trigger)
  return callBackend('set_agent_plugin_trigger', { agentId, trigger })
}

/** `<plugin>.<trigger>`, the select value of a trigger. */
export function triggerKey(trigger: TriggerRef): string {
  return `${trigger.plugin}.${trigger.trigger}`
}
