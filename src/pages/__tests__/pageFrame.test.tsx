import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { ConnectionsPage } from '../ConnectionsPage'
import { HomePage } from '../HomePage'
import { InboxPage } from '../InboxPage'
import { KnowledgePage } from '../KnowledgePage'
import { PluginDetailPage } from '../PluginDetailPage'
import { PluginsPage } from '../PluginsPage'
import { RunsPage } from '../RunsPage'
import { SchedulerPage } from '../SchedulerPage'
import { SettingsPage } from '../SettingsPage'

interface FramedPage {
  name: string
  path: string
  routePattern: string
  page: ReactElement
  title: string | RegExp
}

const framedPages: FramedPage[] = [
  { name: 'Home', path: routePaths.home, routePattern: routePaths.home, page: <HomePage />, title: /^Good (morning|afternoon|evening)$/ },
  { name: 'Runs', path: routePaths.runs, routePattern: routePaths.runs, page: <RunsPage />, title: 'Runs' },
  { name: 'Schedule', path: routePaths.scheduler, routePattern: routePaths.scheduler, page: <SchedulerPage />, title: 'Schedule' },
  { name: 'Knowledge', path: routePaths.knowledge, routePattern: routePaths.knowledge, page: <KnowledgePage />, title: 'Knowledge' },
  { name: 'Inbox', path: routePaths.inbox, routePattern: routePaths.inbox, page: <InboxPage />, title: 'Inbox' },
  { name: 'Plugins', path: routePaths.plugins, routePattern: routePaths.plugins, page: <PluginsPage />, title: 'Plugins' },
  { name: 'Plugin detail', path: pluginDetailPath('whatsapp-api'), routePattern: pluginDetailPattern, page: <PluginDetailPage />, title: 'WhatsApp Cloud API' },
  { name: 'Connections', path: routePaths.connections, routePattern: routePaths.connections, page: <ConnectionsPage />, title: 'Connections' },
  { name: 'Settings', path: routePaths.settings, routePattern: routePaths.settings, page: <SettingsPage />, title: 'Settings' },
]

function renderFramedPage({ path, routePattern, page }: FramedPage) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={page} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('shared page frame', () => {
  it.each(framedPages)('$name puts its title inside the shared page frame', async (framedPage) => {
    renderFramedPage(framedPage)
    const title = await screen.findByRole('heading', { level: 1, name: framedPage.title })
    const pageFrame = title.closest('[data-page-frame]')
    expect(pageFrame).not.toBeNull()
    expect(pageFrame).toHaveClass('px-8', 'py-7')
    // The frame is the panel's own padding: nothing else pads or centres it.
    expect(pageFrame?.parentElement?.tagName).toBe('MAIN')
  })
})
