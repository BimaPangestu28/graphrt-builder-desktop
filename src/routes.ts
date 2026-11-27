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
  learned: '/agents/maps-leads/learned', // 70, What this agent learned
  menuBar: '/menu-bar', // 25
  plugins: '/plugins', // 26, moved out of Connections (21) into its own sidebar item
  skills: '/skills', // 68, Skills (your skills and the catalog's)
  skillCreate: '/skills/new', // 69, Create a skill (wizard)
  putOnline: '/agents/maps-leads/online', // 57-64, Put it online (Where, Provider, Review, progress, done)
  ownServer: '/agents/maps-leads/own-server', // 67, My own server (For IT teams)
  screenIndex: '/screens',
} as const

export type RouteKey = keyof typeof routePaths

/**
 * The old address of the plugins list (Connections → Advanced → Plugins). Connections
 * redirects it to {@link routePaths.plugins} so saved links keep working.
 */
export const legacyConnectionsPluginsSection = 'plugins'

/**
 * Tabs of Connections (21), each at its own address so it deep-links and survives a refresh.
 * `apps` only shows in the browser preview, which has sample app accounts.
 */
export type ConnectionsTab = 'models' | 'secrets' | 'mcp' | 'online' | 'apps'

/** Route pattern of one Connections tab; `routePaths.connections` alone redirects to AI models. */
export const connectionsTabPattern = '/connections/:connectionsTab'

/** Search param that opens a tab's add form (Add secret, Add server) on arrival. */
export const connectionsAddFormParam = 'add'

/**
 * Builds the URL of a Connections tab.
 *
 * @param tab - Which tab to open (ConnectionsTab)
 * @param options.opensAddForm - Also unfold the tab's add form (boolean)
 * @returns The path, e.g. "/connections/secrets?add=1" (string)
 *
 * @example
 * connectionsTabPath('models') // "/connections/models"
 * connectionsTabPath('secrets', { opensAddForm: true }) // "/connections/secrets?add=1"
 */
export function connectionsTabPath(tab: ConnectionsTab, { opensAddForm = false }: { opensAddForm?: boolean } = {}): string {
  const path = connectionsTabPattern.replace(':connectionsTab', tab)
  return opensAddForm ? `${path}?${connectionsAddFormParam}=1` : path
}

/** Plugin detail for any plugin of the catalog or installed. */
export const pluginDetailPattern = '/plugins/:pluginName'

/**
 * Builds the URL of a plugin's detail page.
 *
 * @example
 * pluginDetailPath('whatsapp-web') // "/plugins/whatsapp-web"
 */
export function pluginDetailPath(pluginName: string): string {
  return pluginDetailPattern.replace(':pluginName', encodeURIComponent(pluginName))
}

/** Search param of a plugin's page that scrolls to a section on arrival (`settings`). */
export const pluginSectionParam = 'section'

/**
 * Builds the URL of a plugin's page scrolled to its settings ("Set up").
 *
 * @example
 * pluginSettingsPath('document-templates') // "/plugins/document-templates?section=settings"
 */
export function pluginSettingsPath(pluginName: string): string {
  return `${pluginDetailPath(pluginName)}?${pluginSectionParam}=settings`
}

/** The add / update wizard of a catalog skill. */
export const skillAddPattern = '/skills/add/:skillName'

/**
 * Builds the URL of the wizard that adds (or updates) a catalog skill.
 *
 * @example
 * skillAddPath('refund-policy') // "/skills/add/refund-policy"
 */
export function skillAddPath(skillName: string): string {
  return skillAddPattern.replace(':skillName', encodeURIComponent(skillName))
}

/** The wizard that changes a skill written in the app. */
export const skillEditPattern = '/skills/edit/:skillName'

/**
 * Builds the URL of the wizard that changes a skill written in the app.
 *
 * @example
 * skillEditPath('refund-policy') // "/skills/edit/refund-policy"
 */
export function skillEditPath(skillName: string): string {
  return skillEditPattern.replace(':skillName', encodeURIComponent(skillName))
}

/** Query parameter of "Create a skill": the agent whose notes the draft is written from. */
export const skillFromAgentParam = 'fromAgent'

/**
 * Builds the URL of "Create a skill" starting from what an agent learned.
 *
 * @example
 * skillFromNotesPath('maps-leads') // "/skills/new?fromAgent=maps-leads"
 */
export function skillFromNotesPath(agentId: string): string {
  return `${routePaths.skillCreate}?${skillFromAgentParam}=${encodeURIComponent(agentId)}`
}

/** The page of an installed skill. */
export const skillDetailPattern = '/skills/view/:skillName'

/**
 * Builds the URL of an installed skill's page.
 *
 * @example
 * skillDetailPath('refund-policy') // "/skills/view/refund-policy"
 */
export function skillDetailPath(skillName: string): string {
  return skillDetailPattern.replace(':skillName', encodeURIComponent(skillName))
}

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
  learned: '/agents/:agentId/learned', // 70
  putOnline: '/agents/:agentId/online', // 57-64
  ownServer: '/agents/:agentId/own-server', // 67
} as const

export type AgentRouteKey = keyof typeof agentRoutePatterns

/**
 * Search param of the builder (04) holding a change request to prefill in its chat box, for
 * example from "Ask the builder to fix this step". The builder reads it once and removes it,
 * so a refresh does not prefill again. It is never sent on its own: the user presses Send.
 *
 * @example
 * agentPath('builder', agent.id, { [builderAskParam]: 'Please fix the "Send" step.' })
 */
export const builderAskParam = 'ask'

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

/**
 * Review a run (19) for one paused run. `routePaths.batchApproval` without `runId` opens the
 * latest run waiting for an answer.
 *
 * @example
 * runReviewPath(run.id) // "/runs/review?runId=r1"
 */
export function runReviewPath(runId: string): string {
  return `${routePaths.batchApproval}?${new URLSearchParams({ runId }).toString()}`
}

/** Knowledge detail (18) for any knowledge base; `routePaths.knowledgeDetail` is the sample one. */
export const knowledgeDetailPattern = '/knowledge/:knowledgeBaseId'

/** Knowledge base id used by the sample data (browser preview, tests). */
export const sampleKnowledgeBaseId = 'menu-and-prices'

/**
 * Builds the URL of a knowledge base's detail screen.
 *
 * @example
 * knowledgeDetailPath('kb_123') // "/knowledge/kb_123"
 */
export function knowledgeDetailPath(knowledgeBaseId: string): string {
  return knowledgeDetailPattern.replace(':knowledgeBaseId', encodeURIComponent(knowledgeBaseId))
}
