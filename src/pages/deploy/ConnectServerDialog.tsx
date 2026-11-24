import { useState, type FormEvent } from 'react'
import { connectOwnServer } from '@/api/deploy'
import type { OwnServerView } from '@/api/deployTypes'
import { Badge, Button, Icon } from '@/components/ui'
import { getCredentialStoreName } from '@/lib/platform'
import { DeployDialog, GuideSteps } from './DeployDialog'
import { plainErrorMessage } from './deployDisplay'

const inputClassName = 'box-border h-10 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink'

/** "Connect a running server" (For IT teams): name, address and access key, tested before saving. */
export function ConnectServerDialog({ onClose, onConnected }: { onClose: () => void; onConnected: (view: OwnServerView) => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [connected, setConnected] = useState<OwnServerView | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsConnecting(true)
    setErrorMessage(null)
    try {
      const view = await connectOwnServer(name, url, apiKey)
      setConnected(view)
      onConnected(view)
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }

  const leading = (
    <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-subtle text-[12px] font-semibold text-ink-2">
      IT
    </span>
  )

  if (connected) {
    return (
      <DeployDialog title="Connect a running server" leading={leading} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <div role="status" className="flex items-start gap-3 rounded-[12px] border border-ok-soft bg-ok-tint px-4 py-3">
          <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
          <span>
            <b className="font-semibold">Connected.</b> {connected.server.name} answers. Its runs now show in Runs.
          </span>
        </div>
      </DeployDialog>
    )
  }

  return (
    <DeployDialog title="Connect a running server" leading={leading} onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} aria-label="Connect a running server" className="flex flex-col gap-4">
        <GuideSteps steps={["Ask your IT team for the server's address and access key", 'Fill them in below and connect']} />
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="home-nas" className={inputClassName} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Address
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://agents.example.com" className={inputClassName} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Access key
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className={inputClassName} autoComplete="off" />
        </label>
        <p className="m-0 text-[13px] leading-normal text-muted">
          The access key lets graphrt read this server's runs and approvals. Kept in {getCredentialStoreName()}, never shown again. <Badge>For IT teams</Badge>
        </p>
        {errorMessage && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2 text-[13px] text-danger-deep">
            {errorMessage}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isConnecting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isConnecting || !name.trim() || !url.trim() || !apiKey.trim()}>
            {isConnecting ? 'Connecting…' : errorMessage ? 'Try again' : 'Connect'}
          </Button>
        </div>
      </form>
    </DeployDialog>
  )
}
