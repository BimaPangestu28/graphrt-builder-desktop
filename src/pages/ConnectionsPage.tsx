import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { StrokeIcon } from '@/components/ui'
import {
  advancedConnections,
  connectionCategoryTitles,
  initialConnections,
  type AdvancedConnection,
  type Connection,
  type ConnectionCategory,
} from '@/data/connections'
import { routePaths } from '@/routes'
import { ConnectionCard } from './connections/ConnectionCard'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'

function matchesSearch(searchQuery: string, ...searchableTexts: string[]): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  if (!normalizedQuery) return true
  return searchableTexts.some((text) => text.toLowerCase().includes(normalizedQuery))
}

function ConnectionSection({ category, connections, onSetUp }: { category: ConnectionCategory; connections: Connection[]; onSetUp: (connectionId: string) => void }) {
  const headingId = `connections-${category}-h`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h2 id={headingId} className={sectionHeadingClassNames}>
        {connectionCategoryTitles[category]}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
        {connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} onSetUp={onSetUp} />
        ))}
      </div>
    </section>
  )
}

function AdvancedSection({ rows }: { rows: AdvancedConnection[] }) {
  return (
    <section aria-labelledby="connections-advanced-h" className="flex flex-col gap-2.5">
      <h2 id="connections-advanced-h" className={sectionHeadingClassNames}>
        Advanced
      </h2>
      <div className="rounded-xl border border-line">
        {rows.map((row, index) => (
          <div key={row.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${index < rows.length - 1 ? 'border-b border-chip' : ''}`}>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-[12px] text-muted">{row.description}</span>
            </span>
            {row.kind === 'status' ? (
              <span className="text-[13px] text-ok-strong">Connected</span>
            ) : (
              <Link
                to={routePaths.settings}
                aria-label={`Manage ${row.name}`}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle"
              >
                Manage
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Screen 21 · Connections.
 * Apps, AI models and keys the agents use. Search filters every section, the banner
 * reconnects a signed-out Gmail, and Connect / Add key set up the remaining providers.
 */
export function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>(initialConnections)
  const [searchQuery, setSearchQuery] = useState('')

  const signedOutConnections = connections.filter((connection) => connection.state === 'signedOut')
  const visibleConnections = connections.filter((connection) =>
    matchesSearch(searchQuery, connection.name, connection.connectedDescription, connection.availableDescription),
  )
  const visibleAdvancedRows = advancedConnections.filter((row) => matchesSearch(searchQuery, row.name, row.description))
  const categories: ConnectionCategory[] = ['apps', 'models']
  const hasNoMatches = visibleConnections.length === 0 && visibleAdvancedRows.length === 0

  function markConnected(connectionId: string) {
    setConnections((previousConnections) =>
      previousConnections.map((connection) => (connection.id === connectionId ? { ...connection, state: 'connected' } : connection)),
    )
  }

  return (
    <AppShell activeNav="connections" mainClassName="box-border flex flex-col gap-[26px] px-8 py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.5px]">Connections</h1>
          <span className="text-body">Apps, AI models and keys your agents use. Secrets stay in macOS Keychain</span>
        </div>
        <label className="box-border flex h-10 w-[260px] max-w-full items-center gap-2 rounded-[10px] border border-line-strong px-3 focus-within:border-ink">
          <StrokeIcon size={15} className="text-muted">
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-4.5-4.5" />
          </StrokeIcon>
          <input
            type="search"
            aria-label="Search connections"
            placeholder="Search 40+ apps"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="min-w-0 flex-auto border-0 bg-transparent text-[14px] text-ink outline-none"
          />
        </label>
      </div>

      {signedOutConnections.map((connection) => (
        <div key={connection.id} role="alert" className="flex items-center gap-3.5 rounded-xl border border-danger-line bg-danger-tint px-4 py-3.5">
          <span className="flex-auto leading-normal">
            <b className="font-semibold">{connection.name} needs you to sign in again.</b>{' '}
            <span className="text-danger-deep">{connection.connectedDescription.replace('Used by ', '')} is paused until then</span>
          </span>
          <button
            type="button"
            onClick={() => markConnected(connection.id)}
            className="h-9 cursor-pointer whitespace-nowrap rounded-[9px] border-0 bg-ink px-3.5 text-[13px] font-semibold text-white hover:bg-ink-2"
          >
            Reconnect {connection.name}
          </button>
        </div>
      ))}

      {categories.map((category) => {
        const categoryConnections = visibleConnections.filter((connection) => connection.category === category)
        if (categoryConnections.length === 0) return null
        return <ConnectionSection key={category} category={category} connections={categoryConnections} onSetUp={markConnected} />
      })}

      {visibleAdvancedRows.length > 0 && <AdvancedSection rows={visibleAdvancedRows} />}

      {hasNoMatches && <p className="m-0 text-muted">No connections match “{searchQuery.trim()}”</p>}
    </AppShell>
  )
}
