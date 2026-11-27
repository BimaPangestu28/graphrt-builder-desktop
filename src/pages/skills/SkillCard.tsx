import { Link } from 'react-router-dom'
import type { CatalogSkillEntry, InstalledSkill } from '@/api/skillTypes'
import { Badge, LinkButton, type BadgeTone } from '@/components/ui'
import { useT } from '@/i18n'
import { skillAddPath, skillDetailPath } from '@/routes'
import { describeSkillSource } from './skillDisplay'

const cardClassNames = 'flex h-full flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
/** Two lines, never more: long descriptions are cut with an ellipsis and kept in the tooltip. */
const descriptionClassNames = 'm-0 line-clamp-2 min-h-[38px] text-[13px] leading-[19px] text-body'

interface CardHeadProps {
  title: string
  titleLink: string
  meta: string
  status: { label: string; tone: BadgeTone }
}

function CardHead({ title, titleLink, meta, status }: CardHeadProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="m-0 truncate text-[14px] font-semibold">
          <Link to={titleLink} className="no-underline !text-ink hover:underline">
            {title}
          </Link>
        </h3>
        <span className="truncate text-[12px] text-muted" title={meta}>
          {meta}
        </span>
      </div>
      <Badge tone={status.tone} className="shrink-0">
        {status.label}
      </Badge>
    </div>
  )
}

interface InstalledSkillCardProps {
  skill: InstalledSkill
  /** How many agents use it. */
  agentCount: number
  /** The catalog has a newer version. */
  updateAvailable: boolean
}

/** One of "Your skills": name, where it came from, what it is for, who uses it, and Open. */
export function InstalledSkillCard({ skill, agentCount, updateAvailable }: InstalledSkillCardProps) {
  const t = useT().skills
  const status: CardHeadProps['status'] = updateAvailable
    ? { label: t.statusUpdate, tone: 'amber' }
    : skill.enabled
      ? { label: t.statusOn, tone: 'ok' }
      : { label: t.statusOff, tone: 'neutral' }
  return (
    <article aria-label={skill.displayName} className={cardClassNames}>
      <CardHead title={skill.displayName} titleLink={skillDetailPath(skill.name)} meta={describeSkillSource(skill.source, skill.publisher)} status={status} />
      <p title={skill.description} className={descriptionClassNames}>
        {skill.description}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-chip pt-3">
        <span className="truncate text-[12px] text-muted">{agentCount > 0 ? t.usedBy(agentCount) : t.notUsedYet}</span>
        <div className="flex shrink-0 items-center gap-2">
          {updateAvailable && (
            <LinkButton to={skillAddPath(skill.name)} size="sm" className="!text-inverse">
              <span aria-hidden="true">{t.update}</span>
              <span className="sr-only">{t.updateSkill(skill.displayName)}</span>
            </LinkButton>
          )}
          <LinkButton to={skillDetailPath(skill.name)} variant="secondary" size="sm" className="!text-ink">
            <span aria-hidden="true">{t.open}</span>
            <span className="sr-only">{t.openSkill(skill.displayName)}</span>
          </LinkButton>
        </div>
      </div>
    </article>
  )
}

/** A skill of the catalog: what it is for and one button, Add (or Review update, or Open). */
export function CatalogSkillCard({ skill }: { skill: CatalogSkillEntry }) {
  const t = useT().skills
  const status: CardHeadProps['status'] = skill.updateAvailable
    ? { label: t.statusUpdate, tone: 'amber' }
    : skill.installed
      ? { label: t.statusInstalled, tone: 'ok' }
      : { label: t.checked, tone: 'brand' }
  const meta = [skill.publisher ? t.byPublisher(skill.publisher) : null, skill.version ? t.versionLabel(skill.version) : null].filter(Boolean).join(' · ')
  const titleLink = skill.installed ? skillDetailPath(skill.name) : skillAddPath(skill.name)
  return (
    <article aria-label={skill.displayName} className={cardClassNames}>
      <CardHead title={skill.displayName} titleLink={titleLink} meta={meta} status={status} />
      <p title={skill.description} className={descriptionClassNames}>
        {skill.description}
      </p>
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-chip pt-3">
        {skill.installed && (
          <LinkButton to={skillDetailPath(skill.name)} variant="secondary" size="sm" className="!text-ink">
            <span aria-hidden="true">{t.open}</span>
            <span className="sr-only">{t.openSkill(skill.displayName)}</span>
          </LinkButton>
        )}
        {skill.updateAvailable && (
          <LinkButton to={skillAddPath(skill.name)} size="sm" className="!text-inverse">
            <span aria-hidden="true">{t.update}</span>
            <span className="sr-only">{t.updateSkill(skill.displayName)}</span>
          </LinkButton>
        )}
        {!skill.installed && (
          <LinkButton to={skillAddPath(skill.name)} size="sm" className="!text-inverse">
            <span aria-hidden="true">{t.add}</span>
            <span className="sr-only">{t.addSkill(skill.displayName)}</span>
          </LinkButton>
        )}
      </div>
    </article>
  )
}
