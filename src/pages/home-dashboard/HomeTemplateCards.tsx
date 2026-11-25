import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui'
import { newAgentTemplatePath, type AgentTemplate } from '@/pages/new-agent/agentTemplates'
import { routePaths } from '@/routes'
import { HomeSectionHeader } from './HomeSectionHeader'
import { pickHomeTemplates } from './homeLayout'

/** Three cards a row on a wide page, two on a medium one, one when narrow (container query). */
const templateGridClassName = 'grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 @min-[880px]:grid-cols-3'

/**
 * One template as a card: its title and one sentence, each clamped to two lines (full text on
 * hover), the services it uses, and "Use template", which opens New agent with it picked.
 */
function HomeTemplateCard({ template }: { template: AgentTemplate }) {
  return (
    <Link
      to={newAgentTemplatePath(template.id)}
      aria-label={template.title}
      className="group flex h-full min-w-0 flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-[18px] !text-ink no-underline hover:border-line-heavy"
    >
      <span className="flex items-start justify-between gap-2">
        <span title={template.title} className="line-clamp-2 font-semibold">
          {template.title}
        </span>
        {template.kindLabel ? <span className="shrink-0 pt-0.5 text-[11px] font-semibold text-brand-strong">{template.kindLabel}</span> : null}
      </span>
      <span title={template.description} className="line-clamp-2 text-[13px] leading-normal text-body">
        {template.description}
      </span>
      <span className="mt-auto flex items-center justify-between gap-3 pt-2">
        <span title={template.meta} className="min-w-0 truncate text-[12px] text-muted">
          {template.meta}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand group-hover:text-brand-strong">
          Use template
          <Icon name="arrowRight" size={14} />
        </span>
      </span>
    </Link>
  )
}

/** "Or start from a template": a few templates as cards, with "All templates" for the rest. */
export function HomeTemplateCards() {
  const allTemplatesLink = (
    <Link to={routePaths.newAgent} className="text-[13px] font-medium !text-body no-underline hover:underline">
      All templates
    </Link>
  )
  return (
    <section aria-labelledby="home-templates" className="@container flex min-w-0 flex-col gap-3">
      <HomeSectionHeader headingId="home-templates" heading="Or start from a template" trailing={allTemplatesLink} />
      <div className={templateGridClassName}>
        {pickHomeTemplates().map((template) => (
          <HomeTemplateCard key={template.id} template={template} />
        ))}
      </div>
    </section>
  )
}
