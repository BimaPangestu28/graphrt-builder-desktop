import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '@/components/ui'
import { buildPathByAgentKind } from '@/data/newAgentTemplates'
import type { BuildRequestLocationState } from '@/pages/agent-builder/buildRequestState'

/** Greyed-out example in the empty box (never submitted). */
export const describeAgentPlaceholder = 'Every weekday at 9, find new cafes in Bandar Lampung on Google Maps and send them a WhatsApp offer'

/** ⌘+Enter on macOS, Ctrl+Enter elsewhere. */
function isSubmitShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

/**
 * "Describe a new agent" box on Home. "Build agent" (or ⌘/Ctrl+Enter) starts the same
 * build as the New agent screen: it opens the Generating screen with `{ buildRequest }`
 * router state for a task agent, which runs `buildAgent` with the description.
 */
export function DescribeAgentCard() {
  const navigate = useNavigate()
  const [jobDescription, setJobDescription] = useState('')
  const trimmedDescription = jobDescription.trim()
  const canBuild = trimmedDescription.length > 0

  function startBuild() {
    if (!canBuild) return
    const locationState: BuildRequestLocationState = { buildRequest: { description: trimmedDescription, kind: 'task' } }
    navigate(buildPathByAgentKind.task, { state: locationState })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startBuild()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSubmitShortcut(event)) return
    event.preventDefault()
    startBuild()
  }

  return (
    <section aria-label="Describe a new agent" className="rounded-[14px] border border-line bg-surface p-[18px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="m-0 text-[16px] font-semibold">
          <label htmlFor="home-describe-agent-input">What should your agent do?</label>
        </h2>
        <textarea
          id="home-describe-agent-input"
          rows={2}
          value={jobDescription}
          placeholder={describeAgentPlaceholder}
          onChange={(event) => setJobDescription(event.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none rounded-[10px] border border-line-strong bg-transparent px-3 py-2.5 text-[15px] leading-[1.5] text-ink outline-none placeholder:text-muted focus:border-ink"
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-[13px] text-muted">You see every step before anything runs · ⌘/Ctrl+Enter to build</span>
          <Button type="submit" disabled={!canBuild}>
            Build agent
            <Icon name="arrowRight" size={16} />
          </Button>
        </div>
      </form>
    </section>
  )
}
