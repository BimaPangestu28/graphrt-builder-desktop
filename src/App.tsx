import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { hasFinishedWelcome } from './lib/firstLaunch'
import { agentRoutePatterns, connectionsTabPattern, knowledgeDetailPattern, pluginDetailPattern, routePaths } from './routes'
import { ScreenIndexPage } from './pages/ScreenIndexPage'
import { WelcomePage } from './pages/WelcomePage'
import { NewAgentPage } from './pages/NewAgentPage'
import { GeneratingPage } from './pages/GeneratingPage'
import { BuilderPage } from './pages/BuilderPage'
import { ConnectWhatsAppPage } from './pages/ConnectWhatsAppPage'
import { TestRunPage } from './pages/TestRunPage'
import { RunResultPage } from './pages/RunResultPage'
import { ScheduleAgentPage } from './pages/ScheduleAgentPage'
import { HomePage } from './pages/HomePage'
import { SchedulerPage } from './pages/SchedulerPage'
import { ChainPage } from './pages/ChainPage'
import { AgentAsStepPage } from './pages/AgentAsStepPage'
import { TeamPage } from './pages/TeamPage'
import { ChatbotSetupPage } from './pages/ChatbotSetupPage'
import { InboxPage } from './pages/InboxPage'
import { ChatDetailPage } from './pages/ChatDetailPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { KnowledgeDetailPage } from './pages/KnowledgeDetailPage'
import { BatchApprovalPage } from './pages/BatchApprovalPage'
import { RunsPage } from './pages/RunsPage'
import { ConnectionsPage, ConnectionsTabPage } from './pages/ConnectionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ErrorStatesPage } from './pages/ErrorStatesPage'
import { VersionHistoryPage } from './pages/VersionHistoryPage'
import { MenuBarPage } from './pages/MenuBarPage'
import { PluginsPage } from './pages/PluginsPage'
import { PluginDetailPage } from './pages/PluginDetailPage'

/** Screen components keyed by route, in canvas order. */
const screenRoutes = [
  { path: routePaths.welcome, element: <WelcomePage /> },
  { path: routePaths.newAgent, element: <NewAgentPage /> },
  { path: routePaths.generating, element: <GeneratingPage /> },
  { path: agentRoutePatterns.builder, element: <BuilderPage /> },
  { path: agentRoutePatterns.connectWhatsApp, element: <ConnectWhatsAppPage /> },
  { path: agentRoutePatterns.testRun, element: <TestRunPage /> },
  { path: agentRoutePatterns.runResult, element: <RunResultPage /> },
  { path: agentRoutePatterns.scheduleAgent, element: <ScheduleAgentPage /> },
  { path: routePaths.home, element: <HomePage /> },
  { path: routePaths.scheduler, element: <SchedulerPage /> },
  { path: routePaths.chain, element: <ChainPage /> },
  { path: routePaths.agentAsStep, element: <AgentAsStepPage /> },
  { path: routePaths.team, element: <TeamPage /> },
  { path: routePaths.chatbotSetup, element: <ChatbotSetupPage /> },
  { path: routePaths.inbox, element: <InboxPage /> },
  { path: routePaths.chatDetail, element: <ChatDetailPage /> },
  { path: routePaths.knowledge, element: <KnowledgePage /> },
  { path: knowledgeDetailPattern, element: <KnowledgeDetailPage /> },
  { path: routePaths.batchApproval, element: <BatchApprovalPage /> },
  { path: routePaths.runs, element: <RunsPage /> },
  { path: routePaths.connections, element: <ConnectionsPage /> },
  { path: connectionsTabPattern, element: <ConnectionsTabPage /> },
  { path: routePaths.settings, element: <SettingsPage /> },
  { path: routePaths.errorStates, element: <ErrorStatesPage /> },
  { path: agentRoutePatterns.versionHistory, element: <VersionHistoryPage /> },
  { path: routePaths.menuBar, element: <MenuBarPage /> },
  { path: routePaths.plugins, element: <PluginsPage /> },
  { path: pluginDetailPattern, element: <PluginDetailPage /> },
]

/** `/`: Welcome on first launch (until a choice is made or a model is connected), Home afterwards. */
function StartRedirect() {
  const [isProviderReady, setIsProviderReady] = useState<boolean | null>(null)
  useEffect(() => {
    let isMounted = true
    void hasFinishedWelcome().then((isReady) => {
      if (isMounted) setIsProviderReady(isReady)
    })
    return () => {
      isMounted = false
    }
  }, [])
  if (isProviderReady === null) return null
  return <Navigate to={isProviderReady ? routePaths.home : routePaths.welcome} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<StartRedirect />} />
      {screenRoutes.map((screenRoute) => (
        <Route key={screenRoute.path} path={screenRoute.path} element={screenRoute.element} />
      ))}
      <Route path={routePaths.screenIndex} element={<ScreenIndexPage />} />
      <Route path="*" element={<Navigate to={routePaths.screenIndex} replace />} />
    </Routes>
  )
}
