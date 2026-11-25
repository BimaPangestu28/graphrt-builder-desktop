import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { formatShortcut } from '@/lib/platform'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Icon, joinClassNames } from '@/components/ui'
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

/** `hero` fills the page width on a fresh install; `compact` sits in the dashboard's right rail. */
export type DescribeAgentCardVariant = 'hero' | 'compact'

const variantStyles: Record<DescribeAgentCardVariant, { section: string; heading: string; textarea: string; hint: string; rows: number }> = {
  hero: {
    section: 'p-6',
    hint: 'text-[13px]',
    heading: 'text-[20px] tracking-[-0.2px]',
    textarea: 'min-h-[112px] px-4 py-3 text-[15px]',
    rows: 4,
  },
  compact: {
    section: 'p-4',
    hint: 'text-[12px]',
    heading: 'text-[16px]',
    textarea: 'px-3 py-2 text-[14px]',
    rows: 3,
  },
}

/**
 * "Describe a new agent" box on Home. "Build agent" (or ⌘/Ctrl+Enter) starts the same
 * build as the New agent screen: it opens the Generating screen with `{ buildRequest }`
 * router state for a task agent, which runs `buildAgent` with the description. The compact
 * box links to a template under it; the hero leaves templates to the cards below it.
 *
 * @param variant - 'hero' on a fresh install, 'compact' in the rail (default)
 */
export function DescribeAgentCard({ variant = 'compact' }: { variant?: DescribeAgentCardVariant }) {
  const navigate = useNavigate()
  const [jobDescription, setJobDescription] = useState('')
  const trimmedDescription = jobDescription.trim()
  const canBuild = trimmedDescription.length > 0
  const styles = variantStyles[variant]
  const isHero = variant === 'hero'

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
    <section aria-label="Describe a new agent" className={joinClassNames('rounded-[14px] border border-line bg-surface', styles.section)}>
      <form onSubmit={handleSubmit} className={joinClassNames('flex flex-col', isHero ? 'gap-4' : 'gap-3')}>
        <div className="flex flex-col gap-1">
          <h2 className={joinClassNames('m-0 font-semibold', styles.heading)}>
            <label htmlFor="home-describe-agent-input">What should your agent do?</label>
          </h2>
          {isHero && <p className="m-0 text-[14px] leading-normal text-body">Describe the job in plain words. graphrt turns it into steps you can check</p>}
        </div>
        <textarea
          id="home-describe-agent-input"
          rows={styles.rows}
          value={jobDescription}
          placeholder={describeAgentPlaceholder}
          onChange={(event) => setJobDescription(event.target.value)}
          onKeyDown={handleKeyDown}
          className={joinClassNames(
            'resize-none rounded-[10px] border border-line-strong bg-transparent leading-[1.5] text-ink outline-none placeholder:text-muted focus:border-ink',
            styles.textarea,
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className={joinClassNames('min-w-0 flex-[1_1_160px] leading-normal text-muted', styles.hint)}>You see every step before anything runs · {formatShortcut('Enter')} to build</span>
          <Button type="submit" size={isHero ? 'lg' : 'md'} disabled={!canBuild}>
            Build agent
            <Icon name="arrowRight" size={16} />
          </Button>
        </div>
        {!isHero && <StartFromTemplateLinks />}
      </form>
    </section>
  )
}
