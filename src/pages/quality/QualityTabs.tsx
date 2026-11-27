import { Link } from 'react-router-dom'
import { pillTabClassNames } from '@/components/ui'
import { useT } from '@/i18n'
import { agentPath, type AgentRouteKey } from '@/routes'

export type QualityTab = 'test' | 'release' | 'history'

const tabRoutes: Record<QualityTab, AgentRouteKey> = { test: 'agentTests', release: 'agentReleases', history: 'versionHistory' }
const tabOrder: readonly QualityTab[] = ['test', 'release', 'history']

/** Test, Release and History of one agent: three steps of one page, not three menus. */
export function QualityTabs({ agentId, current }: { agentId: string; current: QualityTab }) {
  const t = useT().quality
  return (
    <nav aria-label={t.tabsLabel} className="flex flex-wrap gap-2">
      {tabOrder.map((tab, index) => (
        <Link key={tab} to={agentPath(tabRoutes[tab], agentId)} aria-current={tab === current ? 'page' : undefined} className={pillTabClassNames(tab === current)}>
          {tab === 'history' ? t.tabs[tab] : `${index + 1}. ${t.tabs[tab]}`}
        </Link>
      ))}
    </nav>
  )
}
