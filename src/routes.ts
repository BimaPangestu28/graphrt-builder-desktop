/**
 * Every screen in the graphrt desktop flow, keyed by its number on the design canvas.
 * Pages link to each other through these paths, so change them here only.
 */
export const routePaths = {
  welcome: '/welcome', // 01
  newAgent: '/new', // 02
  generating: '/new/building', // 03
  builder: '/agents/maps-leads/steps', // 04
  connectWhatsApp: '/agents/maps-leads/connect-whatsapp', // 05
  testRun: '/agents/maps-leads/test', // 06
  runResult: '/agents/maps-leads/test-result', // 07
  scheduleAgent: '/agents/maps-leads/schedule', // 08
  home: '/home', // 09
  scheduler: '/schedule', // 10
  chain: '/agents/leads-recap', // 11
  agentAsStep: '/agents/leads-recap/add-step', // 12
  team: '/agents/sales-team', // 13
  chatbotSetup: '/agents/catering-assistant', // 14
  inbox: '/inbox', // 15
  chatDetail: '/inbox/conversation', // 16
  knowledge: '/knowledge', // 17
  knowledgeDetail: '/knowledge/menu-and-prices', // 18
  batchApproval: '/runs/review', // 19
  runs: '/runs', // 20
  connections: '/connections', // 21
  settings: '/settings', // 22
  errorStates: '/runs/problems', // 23
  versionHistory: '/agents/maps-leads/history', // 24
  menuBar: '/menu-bar', // 25
  screenIndex: '/screens',
} as const

export type RouteKey = keyof typeof routePaths

/**
 * Screens that belong to one agent. App.tsx routes these patterns; `routePaths`
 * above holds the same screens for the sample agent ("maps-leads"), which is what
 * the browser preview and tests use.
 */
export const agentRoutePatterns = {
  builder: '/agents/:agentId/steps', // 04
  connectWhatsApp: '/agents/:agentId/connect-whatsapp', // 05
  testRun: '/agents/:agentId/test', // 06, optional ?runId= to reopen a run
  runResult: '/agents/:agentId/test-result', // 07, ?runId= of the finished run
  scheduleAgent: '/agents/:agentId/schedule', // 08
  versionHistory: '/agents/:agentId/history', // 24
} as const

export type AgentRouteKey = keyof typeof agentRoutePatterns

/** Agent id used by the sample data when no real agent exists (browser preview, tests). */
export const sampleAgentId = 'maps-leads'

/**
 * Builds the URL of an agent screen.
 *
 * @example
 * agentPath('testRun', agent.id, { runId: run.id }) // "/agents/abc/test?runId=r1"
 */
export function agentPath(routeKey: AgentRouteKey, agentId: string, query?: Record<string, string>): string {
  const path = agentRoutePatterns[routeKey].replace(':agentId', encodeURIComponent(agentId))
  const queryString = query ? new URLSearchParams(query).toString() : ''
  return queryString ? `${path}?${queryString}` : path
}
