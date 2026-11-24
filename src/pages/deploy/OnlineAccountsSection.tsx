import { useState } from 'react'
import { disconnectDeployAccount, listDeployAccounts, listOwnServers, removeOwnServer } from '@/api/deploy'
import type { DeployAccount } from '@/api/deployTypes'
import { Badge, Button, StatusDot } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { getCredentialStoreName } from '@/lib/platform'
import { ConnectServerDialog } from './ConnectServerDialog'
import { DevelopersDetails } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'
import { ProviderList } from './ProviderList'

function DisconnectButton({ account, onDone }: { account: DeployAccount; onDone: () => void }) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  if (!isConfirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setIsConfirming(true)}>
        Disconnect
      </Button>
    )
  }
  return (
    <span role="alertdialog" aria-label={`Disconnect ${account.displayName}?`} className="flex flex-wrap items-center gap-2 text-[13px]">
      {account.usedByAgents.length > 0 ? `${account.usedByAgents.join(' and ')} stay online but can't be updated afterwards.` : 'Its key is removed from this computer.'}
      <Button
        size="sm"
        variant="danger"
        onClick={() =>
          void disconnectDeployAccount(account.provider)
            .then(onDone)
            .catch((error) => setErrorMessage(plainErrorMessage(error)))
        }
      >
        Disconnect
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setIsConfirming(false)}>
        Keep
      </Button>
      {errorMessage && <span className="text-danger">{errorMessage}</span>}
    </span>
  )
}

function MyServers() {
  const serversState = useAsyncData(listOwnServers, [])
  const [isConnecting, setIsConnecting] = useState(false)
  const servers = serversState.data ?? []
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[14px] font-semibold">My servers</h3>
      {servers.length === 0 && <span className="text-[13px] text-body">None yet. Connect a graphrt server your IT team runs to see its runs here.</span>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {servers.map(({ server, health }) => (
          <li key={server.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
            <StatusDot tone={health?.healthy ? 'ok' : 'amber'} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{server.name}</span>
              <span className="text-[13px] text-body">{health?.healthy ? 'Connected' : health?.message ?? 'Not checked yet'}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void removeOwnServer(server.id).then(serversState.reload)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="w-fit" onClick={() => setIsConnecting(true)}>
        Connect a server
      </Button>
      {isConnecting && <ConnectServerDialog onClose={() => setIsConnecting(false)} onConnected={() => void serversState.reload()} />}
    </div>
  )
}

/**
 * Connections › Online accounts (D6b): the providers agents can run with (Connect opens a popup,
 * keys go to the keychain), and under "For IT teams" the servers an IT team runs.
 */
export function OnlineAccountsSection({ onAccountsChanged }: { onAccountsChanged?: () => void }) {
  const accountsState = useAsyncData(listDeployAccounts, [])
  const reload = () => {
    void accountsState.reload()
    onAccountsChanged?.()
  }
  return (
    <section aria-label="Online accounts" className="flex flex-col gap-5">
      <span className="text-body">Accounts where your agents can run online. Your access keys are kept in {getCredentialStoreName()}.</span>
      {accountsState.error && <p role="alert" className="m-0 text-danger">Could not load online accounts: {plainErrorMessage(accountsState.error)}</p>}
      {accountsState.data && (
        <ProviderList accounts={accountsState.data} onAccountsChanged={reload} renderConnectedActions={(account) => <DisconnectButton account={account} onDone={reload} />} />
      )}
      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer py-1 text-[13px] font-semibold text-ink-2">For IT teams</summary>
        <div className="mt-3 flex flex-col gap-5">
          <MyServers />
          <div className="flex flex-col gap-1">
            <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold">
              Wake-up services <Badge>Preview</Badge>
            </h3>
            <span className="text-[13px] text-body">None. Only needed if a developer set one up — not available yet.</span>
          </div>
        </div>
      </details>
      <DevelopersDetails>
        <span>
          Credential per provider: Fly.io API token · Google Cloud service-account key (JSON) · AWS access key ID + secret (+ session token) · Azure tenant ID + client ID +
          certificate or secret · kubeconfig context. Disconnect deletes the key from {getCredentialStoreName()} only; agents already online are not touched.
        </span>
      </DevelopersDetails>
    </section>
  )
}
