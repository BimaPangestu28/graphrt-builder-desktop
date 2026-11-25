import type { Agent } from '@/api/types'
import { agentTemplates, type AgentTemplate } from '@/pages/new-agent/agentTemplates'

/** Which Home layout to show (09). */

/**
 * - `firstAgent`: no agent yet, so the describe box is the hero with templates and the checklist under it
 * - `dashboard`: agents, runs, what needs the user and this month (also while agents load or fail to load)
 */
export type HomeLayout = 'firstAgent' | 'dashboard'

/**
 * `firstAgent` once the agent list has loaded empty; `dashboard` otherwise, so a load error
 * or the first load keeps the familiar dashboard with its own messages.
 *
 * @param agents - Null while loading (Agent[] | null)
 * @param agentsError - The load error, if any (Error | null)
 *
 * @example
 * pickHomeLayout([], null) // 'firstAgent'
 */
export function pickHomeLayout(agents: Agent[] | null, agentsError: Error | null): HomeLayout {
  if (agentsError || !agents) return 'dashboard'
  return agents.length === 0 ? 'firstAgent' : 'dashboard'
}

/** Templates offered as cards under the hero: enough for two rows of three. */
export const homeTemplateCount = 6

/**
 * The templates shown on Home, in gallery order (the flagship Maps to WhatsApp first).
 *
 * @param templates - The full gallery (AgentTemplate[])
 * @returns At most `homeTemplateCount` templates (AgentTemplate[])
 */
export function pickHomeTemplates(templates: AgentTemplate[] = agentTemplates): AgentTemplate[] {
  return templates.slice(0, homeTemplateCount)
}

/**
 * The line under the greeting. On a fresh install it points at the first agent; otherwise
 * "3 things need you · next run tomorrow 07:00", each half shown once its data is in.
 *
 * @param layout - The Home layout (HomeLayout)
 * @param needsYouLine - E.g. "Nothing needs you", or null while loading (string | null)
 * @param nextRunLine - E.g. "next run tomorrow 07:00", or null while loading (string | null)
 */
export function describeGreetingSubtitle(layout: HomeLayout, needsYouLine: string | null, nextRunLine: string | null): string {
  if (layout === 'firstAgent') return "Let's build your first agent. Describe a job or pick a template"
  return [needsYouLine, nextRunLine].filter((part): part is string => part !== null).join(' · ')
}
