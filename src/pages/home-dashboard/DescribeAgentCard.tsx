import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { formatShortcut } from '@/lib/platform'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Icon } from '@/components/ui'
import { agentTemplates, buildPathByAgentKind, mapsWhatsAppTemplateId, newAgentTemplatePath } from '@/pages/new-agent/agentTemplates'
import { routePaths } from '@/routes'
import type { BuildRequestLocationState } from '@/pages/agent-builder/buildRequestState'

/** Greyed-out example in the empty box (never submitted). */
export const describeAgentPlaceholder = 'Every weekday at 9, find new cafes in Bandar Lampung on Google Maps and send them a WhatsApp offer'

/** The flagship template, offered as a one-click start under the box. */
const featuredTemplate = agentTemplates.find((template) => template.id === mapsWhatsAppTemplateId)

/**
 * "Start from a template" row: the flagship template opens the New agent screen with it
 * picked; "All templates" opens the gallery.
 */
function StartFromTemplateLinks() {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
      <span>Start from a template:</span>
      {featuredTemplate ? (
        <Link to={newAgentTemplatePath(featuredTemplate.id)} className="font-medium !text-ink">
          {featuredTemplate.title}
        </Link>
      ) : null}
      <Link to={routePaths.newAgent} className="font-medium !text-ink">
        All templates
      </Link>
    </p>
  )
}

/** ⌘+Enter on macOS, Ctrl+Enter elsewhere. */
function isSubmitShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

/**
 * "Describe a new agent" box on Home. "Build agent" (or ⌘/Ctrl+Enter) starts the same
 * build as the New agent screen: it opens the Generating screen with `{ buildRequest }`
 * router state for a task agent, which runs `buildAgent` with the description. Links under
 * it start from a template instead.
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
    <section aria-label="Describe a new agent" className="rounded-[14px] border border-line bg-surface p-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="m-0 text-[16px] font-semibold">
          <label htmlFor="home-describe-agent-input">What should your agent do?</label>
        </h2>
        <textarea
          id="home-describe-agent-input"
          rows={3}
          value={jobDescription}
          placeholder={describeAgentPlaceholder}
          onChange={(event) => setJobDescription(event.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none rounded-[10px] border border-line-strong bg-transparent px-3 py-2 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted focus:border-ink"
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="min-w-0 flex-[1_1_160px] text-[12px] leading-normal text-muted">You see every step before anything runs · {formatShortcut('Enter')} to build</span>
          <Button type="submit" disabled={!canBuild}>
            Build agent
            <Icon name="arrowRight" size={16} />
          </Button>
        </div>
        <StartFromTemplateLinks />
      </form>
    </section>
  )
}
