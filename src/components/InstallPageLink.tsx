import { useState, type MouseEvent } from 'react'
import { openModelInstallPage } from '@/api/credentials'
import type { InstallableModelProvider } from '@/api/types'
import { describeError } from '@/lib/agentDisplay'
import { messages } from '@/i18n'

interface InstallPageLinkProps {
  provider: InstallableModelProvider
  /** The install / download page, kept as `href` so it reads and copies as a real link. */
  url: string
  label: string
}

/**
 * A link to a local model's install page (Claude Code, Codex docs, Ollama download). The
 * app window cannot open web pages itself, so a click asks the backend to open the default
 * browser; a failure is shown under the link.
 */
export function InstallPageLink({ provider, url, label }: InstallPageLinkProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function openInBrowser(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    event.stopPropagation()
    setErrorMessage(null)
    try {
      await openModelInstallPage(provider)
    } catch (openError) {
      setErrorMessage(messages().platform.couldNotOpenPage(describeError(openError)))
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <a href={url} onClick={(event) => void openInBrowser(event)} className="font-medium">
        {label}
      </a>
      {errorMessage && (
        <span role="alert" className="text-[12px] text-danger">
          {errorMessage}
        </span>
      )}
    </span>
  )
}
