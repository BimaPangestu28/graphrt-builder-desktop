import { Link } from 'react-router-dom'
import { PillTabBadge, pillTabClassNames } from '@/components/ui'
import { connectionsTabPath, type ConnectionsTab } from '@/routes'
import type { ConnectionsTabItem } from './connectionsTabs'
import { messages } from '@/i18n'

interface ConnectionsTabBarProps {
  tabs: ConnectionsTabItem[]
  activeTab: ConnectionsTab
}

/**
 * AI models · Secrets · MCP servers (· Apps) as links styled like the Plugins tabs, so each
 * tab has its own address; the open one is marked `aria-current="page"`.
 */
export function ConnectionsTabBar({ tabs, activeTab }: ConnectionsTabBarProps) {
  return (
    <nav aria-label={messages().connections.connectionsSections} className="flex flex-wrap gap-1.5">
      {tabs.map(({ tab, label, badge }) => {
        const isActive = tab === activeTab
        return (
          <Link key={tab} to={connectionsTabPath(tab)} aria-current={isActive ? 'page' : undefined} className={pillTabClassNames(isActive)}>
            {label}
            {badge && (
              <PillTabBadge isActive={isActive} isWarning={badge.isWarning}>
                {badge.text}
              </PillTabBadge>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
