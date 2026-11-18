import type { StatusDotTone } from '@/components/ui'
import { routePaths } from '@/routes'

/** An agent as listed in the sidebar once the user has some (screens 09 onward). */
export interface SidebarAgent {
  id: string
  name: string
  statusTone: StatusDotTone
  /** Short kind label shown on the right: Chatbot, Chain, Team. Plain task agents have none. */
  kindLabel?: string
  path: string
}

export const sidebarAgents: SidebarAgent[] = [
  { id: 'maps-leads', name: 'Maps leads to WhatsApp', statusTone: 'ok', path: routePaths.builder },
  { id: 'catering-assistant', name: 'Catering assistant', statusTone: 'ok', kindLabel: 'Chatbot', path: routePaths.chatbotSetup },
  { id: 'morning-digest', name: 'Morning email digest', statusTone: 'ok', path: routePaths.scheduler },
  { id: 'leads-recap', name: 'Leads to sales recap', statusTone: 'paused', kindLabel: 'Chain', path: routePaths.chain },
  { id: 'sales-team', name: 'Catering sales team', statusTone: 'ok', kindLabel: 'Team', path: routePaths.team },
]
