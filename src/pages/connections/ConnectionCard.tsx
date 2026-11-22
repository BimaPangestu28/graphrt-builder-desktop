import type { ReactNode } from 'react'
import { Badge, Button, joinClassNames, type BadgeTone } from '@/components/ui'
import type { Connection, ConnectionState } from '@/api/appConnectionTypes'

interface ConnectionCardProps {
  connection: Connection
  onSetUp: (connectionId: string) => void
  /** Actions at the bottom of a set-up connection, e.g. Use by default / Replace key / Remove. */
  footer?: ReactNode
}

export const cardStateClassNames: Record<ConnectionState, string> = {
  connected: 'border-line bg-surface',
  default: 'border-brand-line-2 bg-brand-tint shadow-[inset_0_0_0_1px_var(--color-brand-line-2)]',
  signedOut: 'border-danger-line bg-surface',
  available: 'border-line bg-surface',
}

export const statusBadgeTones: Record<ConnectionState, BadgeTone> = {
  connected: 'ok',
  default: 'brand',
  signedOut: 'danger',
  available: 'neutral',
}

function describeStatusLabel(connection: Connection): string {
  if (connection.state === 'signedOut') return 'Signed out'
  if (connection.state === 'available') return 'Not set up'
  return connection.connectedLabel
}

/** The bar pinned to the bottom of a card, so actions line up across a row of cards. */
export function ConnectionCardFooter({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-chip pt-3">{children}</div>
}

/**
 * One app or AI model on the Connections screen, shaped like the Plugins grid cards: name
 * and a status badge on top, one line of detail, then actions pinned to the bottom. Ones
 * not set up yet offer Connect / Add key there; set-up ones show their `footer`.
 */
export function ConnectionCard({ connection, onSetUp, footer }: ConnectionCardProps) {
  const isAvailable = connection.state === 'available'
  const description = isAvailable ? connection.availableDescription : connection.connectedDescription
  return (
    <div className={joinClassNames('flex h-full min-w-0 flex-col gap-2 rounded-[14px] border p-4', cardStateClassNames[connection.state])}>
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">{connection.name}</b>
        <Badge tone={statusBadgeTones[connection.state]} className="shrink-0">
          {describeStatusLabel(connection)}
        </Badge>
      </div>
      <p className="m-0 text-[13px] leading-normal text-body">{description}</p>
      {isAvailable ? (
        <ConnectionCardFooter>
          <Button variant="secondary" size="sm" aria-label={`${connection.setupActionLabel} ${connection.name}`} onClick={() => onSetUp(connection.id)}>
            {connection.setupActionLabel}
          </Button>
        </ConnectionCardFooter>
      ) : (
        footer && <ConnectionCardFooter>{footer}</ConnectionCardFooter>
      )}
    </div>
  )
}
