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
import { messages } from '@/i18n'

function DisconnectButton({ account, onDone }: { account: DeployAccount; onDone: () => void }) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  if (!isConfirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setIsConfirming(true)}>
        {messages().deploy.disconnect}
      </Button>
    )
  }
  return (
    <span role="alertdialog" aria-label={messages().deploy.disconnectDisplayname(account.displayName)} className="flex flex-wrap items-center gap-2 text-[13px]">
      {account.usedByAgents.length > 0 ? messages().deploy.stayOnlineNoUpdates(messages().common.joinAnd(account.usedByAgents)) : messages().deploy.itsKeyIsRemovedFromThis}
      <Button
        size="sm"
        variant="danger"
        onClick={() =>
          void disconnectDeployAccount(account.provider)
            .then(onDone)
            .catch((error) => setErrorMessage(plainErrorMessage(error)))
        }
      >
        {messages().deploy.disconnect}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setIsConfirming(false)}>
        {messages().deploy.keep}
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
      <h3 className="m-0 text-[14px] font-semibold">{messages().deploy.myServers}</h3>
      {servers.length === 0 && <span className="text-[13px] text-body">{messages().deploy.noneYetConnectAGraphrtServer}</span>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {servers.map(({ server, health }) => (
          <li key={server.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
            <StatusDot tone={health?.healthy ? 'ok' : 'amber'} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{server.name}</span>
              <span className="text-[13px] text-body">{health?.healthy ? messages().deploy.connected : health?.message ?? messages().deploy.notCheckedYet}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void removeOwnServer(server.id).then(serversState.reload)}>
              {messages().deploy.remove}
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="w-fit" onClick={() => setIsConnecting(true)}>
        {messages().deploy.connectAServer}
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
    <section aria-label={messages().deploy.onlineAccounts} className="flex flex-col gap-5">
      <span className="text-body">{messages().deploy.accountsWhereYourAgentsCanRun}{' '}{getCredentialStoreName()}.</span>
      {accountsState.error && <p role="alert" className="m-0 text-danger">{messages().deploy.couldNotLoadOnlineAccounts}{' '}{plainErrorMessage(accountsState.error)}</p>}
      {accountsState.data && (
        <ProviderList accounts={accountsState.data} onAccountsChanged={reload} renderConnectedActions={(account) => <DisconnectButton account={account} onDone={reload} />} />
      )}
      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer py-1 text-[13px] font-semibold text-ink-2">{messages().deploy.forItTeams}</summary>
        <div className="mt-3 flex flex-col gap-5">
          <MyServers />
          <div className="flex flex-col gap-1">
            <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold">
              {messages().deploy.wakeUpServices}{' '}<Badge>{messages().deploy.preview}</Badge>
            </h3>
            <span className="text-[13px] text-body">{messages().deploy.noneOnlyNeededIfADeveloper}</span>
          </div>
        </div>
      </details>
      <DevelopersDetails>
        <span>
          {messages().deploy.credentialPerProviderFlyIoApi}{' '}{getCredentialStoreName()} {messages().deploy.onlyAgentsAlreadyOnlineAreNot}
        </span>
      </DevelopersDetails>
    </section>
  )
}
