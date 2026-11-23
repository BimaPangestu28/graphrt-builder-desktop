import { useId, useState, type FormEvent } from 'react'
import { useTrustedLookupHosts } from '@/hooks/useTrustedLookupHosts'
import { Button, joinClassNames } from '@/components/ui'

/** What the section says about trusted hosts (also used by the chatbot setup page). */
export const trustedHostsExplanation = 'Read-only requests to these sites run without asking. Anything that changes data still asks you first.'

interface TrustedHostsSectionProps {
  agentId: string
  /** Smaller type and spacing for the Nodes inspector. */
  isCompact?: boolean
  /** An extra line under the explanation (the chatbot page says why chatbots need it). */
  note?: string
  className?: string
}

/**
 * "Trusted hosts for lookups": the sites an agent may look things up on without asking
 * (Builder › Steps, the HTTP request inspector, chatbot setup). Lists them with Remove and
 * adds one typed by the user; the backend checks the host and says what is wrong with it.
 */
export function TrustedHostsSection({ agentId, isCompact = false, note, className }: TrustedHostsSectionProps) {
  const { hosts, loadError, changeError, isChanging, addHost, removeHost } = useTrustedLookupHosts(agentId)
  const [draftHost, setDraftHost] = useState('')
  const inputId = useId()
  const headingId = useId()

  async function submitHost(event: FormEvent) {
    event.preventDefault()
    if (!draftHost.trim()) return
    if (await addHost(draftHost)) setDraftHost('')
  }

  return (
    <section aria-labelledby={headingId} className={joinClassNames('flex flex-col gap-2', className)}>
      <h3 id={headingId} className={joinClassNames('m-0 font-semibold text-ink', isCompact ? 'text-[13px]' : 'text-[15px]')}>
        Trusted hosts for lookups
      </h3>
      <p className="m-0 text-[12px] leading-normal text-body">{trustedHostsExplanation}</p>
      {note && <p className="m-0 text-[12px] leading-normal text-muted">{note}</p>}
      {loadError && <p className="m-0 text-[12px] text-danger">Could not read the trusted hosts: {loadError.message}</p>}
      {hosts && hosts.length === 0 && <p className="m-0 text-[12px] text-muted">No trusted hosts yet</p>}
      {hosts && hosts.length > 0 && (
        <ul aria-label="Trusted hosts" className="m-0 flex list-none flex-col gap-1 p-0">
          {hosts.map((host) => (
            <li key={host} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
              <span className="min-w-0 truncate font-mono text-[12px] text-ink">{host}</span>
              <button
                type="button"
                aria-label={`Stop trusting ${host}`}
                disabled={isChanging}
                onClick={() => void removeHost(host)}
                className="h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void submitHost(event)} className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Site to trust
        </label>
        <input
          id={inputId}
          value={draftHost}
          onChange={(event) => setDraftHost(event.target.value)}
          placeholder="api.example.com"
          autoComplete="off"
          spellCheck={false}
          className="box-border h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 font-mono text-[12px] text-ink"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={isChanging || !draftHost.trim()}>
          Trust
        </Button>
      </form>
      {changeError && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {changeError.message}
        </p>
      )}
    </section>
  )
}
