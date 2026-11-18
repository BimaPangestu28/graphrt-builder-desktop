import { Navigate, Route, Routes } from 'react-router-dom'
import { agentRoutePatterns, routePaths } from './routes'
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
import { ConnectionsPage } from './pages/ConnectionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ErrorStatesPage } from './pages/ErrorStatesPage'
import { VersionHistoryPage } from './pages/VersionHistoryPage'
import { MenuBarPage } from './pages/MenuBarPage'

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
  { path: routePaths.knowledgeDetail, element: <KnowledgeDetailPage /> },
  { path: routePaths.batchApproval, element: <BatchApprovalPage /> },
  { path: routePaths.runs, element: <RunsPage /> },
  { path: routePaths.connections, element: <ConnectionsPage /> },
  { path: routePaths.settings, element: <SettingsPage /> },
  { path: routePaths.errorStates, element: <ErrorStatesPage /> },
  { path: agentRoutePatterns.versionHistory, element: <VersionHistoryPage /> },
  { path: routePaths.menuBar, element: <MenuBarPage /> },
]

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={routePaths.welcome} replace />} />
      {screenRoutes.map((screenRoute) => (
        <Route key={screenRoute.path} path={screenRoute.path} element={screenRoute.element} />
      ))}
      <Route path={routePaths.screenIndex} element={<ScreenIndexPage />} />
      <Route path="*" element={<Navigate to={routePaths.screenIndex} replace />} />
    </Routes>
  )
}
