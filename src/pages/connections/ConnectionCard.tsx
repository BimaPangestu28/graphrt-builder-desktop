import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import type { Connection, ConnectionState } from '@/data/connections'

interface ConnectionCardProps {
  connection: Connection
  onSetUp: (connectionId: string) => void
  /** Extra actions under a set-up connection, e.g. Replace key / Remove. */
  footer?: ReactNode
}

const cardBorderClassNames: Record<ConnectionState, string> = {
  connected: 'border border-line',
  default: 'border-2 border-ink',
  signedOut: 'border border-danger-line',
  available: 'border border-line',
}

const statusLabelClassNames: Record<Exclude<ConnectionState, 'available'>, string> = {
  connected: 'font-medium text-ok-strong',
  default: 'font-semibold text-ink-2',
  signedOut: 'font-medium text-danger',
}

/**
 * One app or AI model on the Connections screen. Set-up connections show their status
 * and usage; ones not set up yet show a Connect / Add key button instead.
 */
export function ConnectionCard({ connection, onSetUp, footer }: ConnectionCardProps) {
  const cardClassNames = joinClassNames('rounded-xl p-3.5', cardBorderClassNames[connection.state])

  if (connection.state === 'available') {
    return (
      <div className={joinClassNames(cardClassNames, 'flex items-center justify-between gap-3')}>
        <span className="flex flex-col gap-1">
          <b className="font-semibold">{connection.name}</b>
          <span className="text-[13px] text-body">{connection.availableDescription}</span>
        </span>
        <button
          type="button"
          aria-label={`${connection.setupActionLabel} ${connection.name}`}
          onClick={() => onSetUp(connection.id)}
          className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
        >
          {connection.setupActionLabel}
        </button>
      </div>
    )
  }

  const statusLabel = connection.state === 'signedOut' ? 'Signed out' : connection.connectedLabel
  return (
    <div className={joinClassNames(cardClassNames, 'flex flex-col gap-2')}>
      <div className="flex justify-between gap-2">
        <b className="font-semibold">{connection.name}</b>
        <span className={joinClassNames('text-[12px]', statusLabelClassNames[connection.state])}>{statusLabel}</span>
      </div>
      <span className="text-[13px] text-body">{connection.connectedDescription}</span>
      {footer}
    </div>
  )
}
