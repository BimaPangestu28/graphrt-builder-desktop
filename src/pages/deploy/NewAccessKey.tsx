import { useState } from 'react'
import { rotateDeploymentApiKey } from '@/api/deploy'
import type { DeploymentView, RotatedApiKey } from '@/api/deployTypes'
import { Button } from '@/components/ui'
import { getCredentialStoreName } from '@/lib/platform'
import { plainErrorMessage } from './deployDisplay'
import { messages } from '@/i18n'

interface NewAccessKeyProps {
  agentId: string
  /** Called with the deployment after the key changed. */
  onViewChange?: (view: DeploymentView) => void
}

/**
 * "Make a new key" in the connection details for developers: asks first (the current key stops
 * working), then shows the new key once. Runs `graphrt deploy --rotate-api-key` in the backend.
 */
export function NewAccessKey({ agentId, onViewChange }: NewAccessKeyProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isMaking, setIsMaking] = useState(false)
  const [rotated, setRotated] = useState<RotatedApiKey | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)

  async function makeNewKey() {
    setIsMaking(true)
    setErrorMessage(null)
    try {
      const result = await rotateDeploymentApiKey(agentId)
      setRotated(result)
      setIsConfirming(false)
      onViewChange?.(result.view)
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setIsMaking(false)
    }
  }

  if (rotated) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-ink-2">{messages().deploy.newAccessKey}</span>
        <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]">{rotated.apiKey}</code>
        <span className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(rotated.apiKey)
              setIsCopied(true)
            }}
          >
            {isCopied ? messages().deploy.copied : messages().deploy.copyKey}
          </Button>
          <span className="text-[12px] text-muted">{messages().deploy.shownOnceTheOldKeyNo}{' '}{getCredentialStoreName()}{messages().deploy.forRuns}</span>
        </span>
        {rotated.problem && (
          <p role="status" className="m-0 text-[13px] text-amber-strong">
            {rotated.problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {isConfirming ? (
        <>
          <span className="leading-normal">{messages().deploy.makeANewAccessKeyThe}</span>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void makeNewKey()} disabled={isMaking}>
              {isMaking ? messages().deploy.makingANewKey : messages().deploy.makeANewKey}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsConfirming(false)} disabled={isMaking}>
              {messages().deploy.cancel}
            </Button>
          </span>
        </>
      ) : (
        <Button size="sm" variant="secondary" className="w-fit" onClick={() => setIsConfirming(true)}>
          {messages().deploy.makeANewKey}
        </Button>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
