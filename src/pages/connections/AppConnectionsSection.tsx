import { connectionCategoryTitles } from '@/pages/connections/modelCardTemplates'
import type { Connection } from '@/api/appConnectionTypes'
import { ConnectionCard } from './ConnectionCard'
import { ConnectionsSection } from './ConnectionsSection'
import { connectionCardGridClassNames } from './ModelProvidersSection'
import { messages } from '@/i18n'

interface AppConnectionsSectionProps {
  connections: Connection[]
  onSetUp: (connectionId: string) => void
}

/**
 * The Apps tab of screen 21: app accounts (WhatsApp, Gmail...). Only the browser preview has
 * any; the desktop app reaches apps through plugins, so it never shows this tab.
 */
export function AppConnectionsSection({ connections, onSetUp }: AppConnectionsSectionProps) {
  return (
    <ConnectionsSection id="connections-apps" title={connectionCategoryTitles.apps} description={messages().connections.accountsYourAgentsReadFromAnd}>
      <div className={connectionCardGridClassNames}>
        {connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} onSetUp={onSetUp} />
        ))}
      </div>
    </ConnectionsSection>
  )
}
