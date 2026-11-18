import type { ProblemAction } from '@/api/problemTypes'
import { agentPath, connectionsPluginsPath, routePaths } from '@/routes'

/**
 * Where a problem button goes. Commands (`retry_run`, `install_browser`) have no path;
 * {@link ProblemActionControl} runs them instead.
 *
 * @param action - Problem action from the backend (ProblemAction)
 * @returns The route to open, or null for a command (string | null)
 */
export function getProblemActionPath(action: ProblemAction): string | null {
  switch (action.kind) {
    case 'open_run':
      return action.runId ? `${routePaths.errorStates}?${new URLSearchParams({ runId: action.runId })}` : routePaths.errorStates
    case 'open_connections':
      return routePaths.connections
    case 'open_plugins':
      return connectionsPluginsPath
    case 'open_builder':
      return action.agentId ? agentPath('builder', action.agentId) : routePaths.home
    case 'open_schedule':
      return action.agentId ? agentPath('scheduleAgent', action.agentId) : routePaths.scheduler
    case 'retry_run':
    case 'install_browser':
      return null
  }
}
