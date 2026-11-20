import { Link } from 'react-router-dom'
import { Icon, buttonClassNames } from '@/components/ui'
import type { AdvancedConnection } from '@/data/connections'
import { routePaths } from '@/routes'
import { connectionsCardClassNames } from './ConnectionsSection'

/** Plugins used to be managed on Connections; this small card only points to their page. */
export function PluginsLinkCard({ row }: { row: AdvancedConnection }) {
  return (
    <aside aria-label={row.name} className={`flex flex-wrap items-center gap-x-4 gap-y-2 bg-subtle px-4 py-3 ${connectionsCardClassNames}`}>
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-2">
        <Icon name="link" size={16} />
      </span>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{row.name}</span>
        <span className="text-[12px] text-muted">{row.description}</span>
      </span>
      <Link to={routePaths.plugins} className={buttonClassNames('secondary', 'sm', 'ml-auto !text-ink')}>
        Open Plugins
        <Icon name="arrowRight" size={14} />
      </Link>
    </aside>
  )
}
