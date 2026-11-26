import { Suspense, lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { hasFinishedWelcome } from './lib/firstLaunch'
import { prefetchWhenIdle, type ChunkLoader } from './lib/prefetchWhenIdle'
import { agentRoutePatterns, connectionsTabPattern, knowledgeDetailPattern, pluginDetailPattern, routePaths, skillAddPattern, skillDetailPattern } from './routes'
import { ScreenLoading } from './components/layout/ScreenLoading'

/**
 * A screen loaded on first visit. Each page (and what only it uses: the Nodes canvas,
 * the scheduler calendar…) becomes its own chunk, so the window opens on the code of
 * one screen instead of all of them.
 *
 * @param loadModule - Dynamic import of the page module (() => Promise<Module>)
 * @param exportName - The page's named export (string)
 * @returns A lazy component to render inside `<Suspense>` (LazyExoticComponent)
 */
function lazyScreen<Module extends Record<string, unknown>, ExportName extends keyof Module & string>(
  loadModule: () => Promise<Module>,
  exportName: ExportName,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => ({ default: (await loadModule())[exportName] as ComponentType }))
}

const ScreenIndexPage = lazyScreen(() => import('./pages/ScreenIndexPage'), 'ScreenIndexPage')
const WelcomePage = lazyScreen(() => import('./pages/WelcomePage'), 'WelcomePage')
const NewAgentPage = lazyScreen(() => import('./pages/NewAgentPage'), 'NewAgentPage')
const GeneratingPage = lazyScreen(() => import('./pages/GeneratingPage'), 'GeneratingPage')
const BuilderPage = lazyScreen(() => import('./pages/BuilderPage'), 'BuilderPage')
const ConnectWhatsAppPage = lazyScreen(() => import('./pages/ConnectWhatsAppPage'), 'ConnectWhatsAppPage')
const TestRunPage = lazyScreen(() => import('./pages/TestRunPage'), 'TestRunPage')
const RunResultPage = lazyScreen(() => import('./pages/RunResultPage'), 'RunResultPage')
const ScheduleAgentPage = lazyScreen(() => import('./pages/ScheduleAgentPage'), 'ScheduleAgentPage')
const HomePage = lazyScreen(() => import('./pages/HomePage'), 'HomePage')
const SchedulerPage = lazyScreen(() => import('./pages/SchedulerPage'), 'SchedulerPage')
const ChainPage = lazyScreen(() => import('./pages/ChainPage'), 'ChainPage')
const AgentAsStepPage = lazyScreen(() => import('./pages/AgentAsStepPage'), 'AgentAsStepPage')
const TeamPage = lazyScreen(() => import('./pages/TeamPage'), 'TeamPage')
const ChatbotSetupPage = lazyScreen(() => import('./pages/ChatbotSetupPage'), 'ChatbotSetupPage')
const InboxPage = lazyScreen(() => import('./pages/InboxPage'), 'InboxPage')
const ChatDetailPage = lazyScreen(() => import('./pages/ChatDetailPage'), 'ChatDetailPage')
const KnowledgePage = lazyScreen(() => import('./pages/KnowledgePage'), 'KnowledgePage')
const KnowledgeDetailPage = lazyScreen(() => import('./pages/KnowledgeDetailPage'), 'KnowledgeDetailPage')
const BatchApprovalPage = lazyScreen(() => import('./pages/BatchApprovalPage'), 'BatchApprovalPage')
const RunsPage = lazyScreen(() => import('./pages/RunsPage'), 'RunsPage')
const ConnectionsPage = lazyScreen(() => import('./pages/ConnectionsPage'), 'ConnectionsPage')
const ConnectionsTabPage = lazyScreen(() => import('./pages/ConnectionsPage'), 'ConnectionsTabPage')
const SettingsPage = lazyScreen(() => import('./pages/SettingsPage'), 'SettingsPage')
const ErrorStatesPage = lazyScreen(() => import('./pages/ErrorStatesPage'), 'ErrorStatesPage')
const VersionHistoryPage = lazyScreen(() => import('./pages/VersionHistoryPage'), 'VersionHistoryPage')
const MenuBarPage = lazyScreen(() => import('./pages/MenuBarPage'), 'MenuBarPage')
const PluginsPage = lazyScreen(() => import('./pages/PluginsPage'), 'PluginsPage')
const PluginDetailPage = lazyScreen(() => import('./pages/PluginDetailPage'), 'PluginDetailPage')
const SkillsPage = lazyScreen(() => import('./pages/SkillsPage'), 'SkillsPage')
const SkillAddPage = lazyScreen(() => import('./pages/SkillAddPage'), 'SkillAddPage')
const SkillCreatePage = lazyScreen(() => import('./pages/SkillCreatePage'), 'SkillCreatePage')
const SkillDetailPage = lazyScreen(() => import('./pages/SkillDetailPage'), 'SkillDetailPage')
const AgentLearnedPage = lazyScreen(() => import('./pages/AgentLearnedPage'), 'AgentLearnedPage')
const PutOnlinePage = lazyScreen(() => import('./pages/PutOnlinePage'), 'PutOnlinePage')
const OwnServerPage = lazyScreen(() => import('./pages/OwnServerPage'), 'OwnServerPage')

/**
 * Screens most visits reach from Home, warmed up once the window is idle (production
 * only: tests and the dev server load each screen when it is opened). The Nodes canvas
 * and the ELK worker stay on demand.
 */
const idlePrefetchedScreens: readonly ChunkLoader[] = [
  () => import('./pages/HomePage'),
  () => import('./pages/BuilderPage'),
  () => import('./pages/RunsPage'),
  () => import('./pages/TestRunPage'),
  () => import('./pages/RunResultPage'),
  () => import('./pages/ConnectionsPage'),
  () => import('./pages/SettingsPage'),
  () => import('./pages/PluginsPage'),
]

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
  { path: routePaths.skills, element: <SkillsPage /> },
  { path: routePaths.skillCreate, element: <SkillCreatePage /> },
  { path: skillAddPattern, element: <SkillAddPage /> },
  { path: skillDetailPattern, element: <SkillDetailPage /> },
  { path: agentRoutePatterns.learned, element: <AgentLearnedPage /> },
  { path: agentRoutePatterns.putOnline, element: <PutOnlinePage /> },
  { path: agentRoutePatterns.ownServer, element: <OwnServerPage /> },
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
  useEffect(() => (__IDLE_PREFETCH__ ? prefetchWhenIdle(idlePrefetchedScreens) : undefined), [])
  return (
    <Suspense fallback={<ScreenLoading />}>
      <Routes>
        <Route path="/" element={<StartRedirect />} />
        {screenRoutes.map((screenRoute) => (
          <Route key={screenRoute.path} path={screenRoute.path} element={screenRoute.element} />
        ))}
        <Route path={routePaths.screenIndex} element={<ScreenIndexPage />} />
        <Route path="*" element={<Navigate to={routePaths.screenIndex} replace />} />
      </Routes>
    </Suspense>
  )
}
