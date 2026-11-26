import { useState, type ReactNode } from 'react'
import type { DeployAccount, DeployProvider } from '@/api/deployTypes'
import { Badge, Button, joinClassNames } from '@/components/ui'
import { ConnectProviderDialog } from './ConnectProviderDialog'
import { ProviderLogo } from './ProviderLogo'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** One plain line per provider, as people read it. */
export const providerTaglines: Readonly<Record<DeployProvider, string>> = localizedRecord(() => messages().deploy.taglines)

export const otherProviders: DeployProvider[] = ['google_cloud', 'aws', 'azure', 'kubernetes']

interface ProviderRowProps {
  account: DeployAccount
  /** Wizard: the row is a choice (radio); Connections: it is not. */
  selection?: { isSelected: boolean; onSelect: () => void }
  onConnect: () => void
  /** Extra actions for a connected row (Disconnect in Connections). */
  connectedActions?: ReactNode
}

export function ProviderRow({ account, selection, onConnect, connectedActions }: ProviderRowProps) {
  const isRecommended = account.provider === 'fly'
  const tagline = account.connected && account.usedByAgents.length > 0 ? messages().deploy.usedByAgents(messages().common.joinAnd(account.usedByAgents)) : providerTaglines[account.provider]
  const content = (
    <>
      <ProviderLogo provider={account.provider} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {account.displayName}
          {isRecommended && <Badge tone="brand">{messages().deploy.recommended}</Badge>}
          {!account.canDeploy && <Badge>{messages().deploy.comingSoon}</Badge>}
        </span>
        <span className="text-[13px] leading-normal text-body">{tagline}</span>
      </span>
    </>
  )
  return (
    <li
      className={joinClassNames(
        'flex flex-wrap items-center gap-3 rounded-[14px] border bg-surface px-4 py-3.5',
        selection?.isSelected ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line',
      )}
    >
      {selection ? (
        <label className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-center gap-3">
          <input type="radio" name="deploy-provider" checked={selection.isSelected} onChange={selection.onSelect} className="sr-only" aria-label={account.displayName} />
          {content}
        </label>
      ) : (
        <span className="flex min-w-0 flex-[1_1_260px] items-center gap-3">{content}</span>
      )}
      {account.connected ? (
        <span className="flex items-center gap-2">
          <Badge tone="ok">{messages().deploy.connected}</Badge>
          {connectedActions}
        </span>
      ) : (
        <Button variant={isRecommended ? 'primary' : 'secondary'} size="sm" onClick={onConnect} aria-label={messages().deploy.connectDisplayname(account.displayName)}>
          {messages().deploy.connect}
        </Button>
      )}
    </li>
  )
}

interface ProviderListProps {
  accounts: DeployAccount[]
  selectedProvider?: DeployProvider | null
  onSelect?: (provider: DeployProvider) => void
  /** After a Connect popup saved an account. */
  onAccountsChanged: () => void
  renderConnectedActions?: (account: DeployAccount) => ReactNode
}

/**
 * Fly.io on top, then "Other providers — for teams that already use them" (folded unless one is
 * connected or chosen). Connect opens the provider's popup.
 */
export function ProviderList({ accounts, selectedProvider, onSelect, onAccountsChanged, renderConnectedActions }: ProviderListProps) {
  const [connectingProvider, setConnectingProvider] = useState<DeployProvider | null>(null)
  const fly = accounts.find((account) => account.provider === 'fly')
  const others = accounts.filter((account) => account.provider !== 'fly')
  const opensOthers = others.some((account) => account.connected || account.provider === selectedProvider)
  const row = (account: DeployAccount) => (
    <ProviderRow
      key={account.provider}
      account={account}
      selection={onSelect ? { isSelected: selectedProvider === account.provider, onSelect: () => onSelect(account.provider) } : undefined}
      onConnect={() => setConnectingProvider(account.provider)}
      connectedActions={renderConnectedActions?.(account)}
    />
  )
  return (
    <div className="flex flex-col gap-3">
      {fly && <ul className="m-0 flex list-none flex-col gap-2 p-0">{row(fly)}</ul>}
      <details open={opensOthers} className="flex flex-col gap-2">
        <summary className="cursor-pointer py-1 text-[13px] font-semibold text-ink-2">{messages().deploy.otherProvidersForTeamsThatAlready}</summary>
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">{others.map(row)}</ul>
      </details>
      {connectingProvider && (
        <ConnectProviderDialog
          provider={connectingProvider}
          onClose={() => setConnectingProvider(null)}
          onConnected={(account) => {
            onAccountsChanged()
            onSelect?.(account.provider)
          }}
        />
      )}
    </div>
  )
}
