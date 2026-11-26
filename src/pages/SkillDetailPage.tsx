import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listInstalledSkills, listSkillCatalog, removeSkill, setSkillEnabled, setSkillPermissions } from '@/api/skills'
import type { InstalledSkill, ToolPermission } from '@/api/skillTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Badge, Button, Card, Icon, LinkButton } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { formatDate, useT } from '@/i18n'
import { routePaths, skillAddPath } from '@/routes'
import { AgentSkillPicker } from './skills/AgentSkillPicker'
import { SkillFindingsList } from './skills/SkillFindingsList'
import { describeSkillSource } from './skills/skillDisplay'
import { ToolPermissionPicker } from './skills/ToolPermissionPicker'

interface SkillPageData {
  skill: InstalledSkill | null
  updateAvailable: boolean
}

async function loadSkillPage(skillName: string): Promise<SkillPageData> {
  const [installed, catalog] = await Promise.all([listInstalledSkills(), listSkillCatalog().catch(() => null)])
  return {
    skill: installed.find((candidate) => candidate.name === skillName) ?? null,
    updateAvailable: catalog?.skills.some((entry) => entry.name === skillName && entry.updateAvailable) ?? false,
  }
}

function samePermissions(left: readonly ToolPermission[], right: readonly ToolPermission[]): boolean {
  const key = (permissions: readonly ToolPermission[]) =>
    permissions
      .map((permission) => `${permission.tool}=${permission.mode}`)
      .sort()
      .join('|')
  return key(left) === key(right)
}

function SectionCard({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="m-0 text-[16px] font-semibold">{heading}</h2>
      {children}
    </Card>
  )
}

/** "What it may use" of an installed skill: change the ticks, then Save choices. */
function PermissionsSection({ skill, onSaved }: { skill: InstalledSkill; onSaved: (skill: InstalledSkill) => void }) {
  const t = useT().skills
  const [draft, setDraft] = useState<ToolPermission[]>(skill.permissions)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isChanged = !samePermissions(draft, skill.permissions)

  async function save() {
    setIsSaving(true)
    setError(null)
    try {
      onSaved(await setSkillPermissions(skill.name, draft))
    } catch (saveError) {
      setError(t.tools.couldNotSave(describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SectionCard heading={t.detail.toolsHeading}>
      <ToolPermissionPicker requestedTools={skill.requestedTools} unsupportedTools={skill.unsupportedTools} permissions={draft} onChange={setDraft} disabled={isSaving} />
      {skill.requestedTools.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!isChanged || isSaving} onClick={() => void save()}>
            {t.tools.save}
          </Button>
          <span role="status" className="text-[13px] text-muted">
            {isChanged ? t.tools.allowedCount(draft.length, skill.requestedTools.length) : t.tools.saved}
          </span>
          {error && (
            <span role="alert" className="text-[13px] text-danger">
              {error}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  )
}

/** Remove asks once more in place (no system dialog), and says what removing does. */
function RemoveSection({ skill }: { skill: InstalledSkill }) {
  const t = useT().skills.detail
  const cancelLabel = useT().skills.wizard.cancel
  const navigate = useNavigate()
  const [isAsking, setIsAsking] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setIsRemoving(true)
    setError(null)
    try {
      await removeSkill(skill.name)
      navigate(routePaths.skills)
    } catch (removeError) {
      setError(t.couldNotRemove(describeError(removeError)))
      setIsRemoving(false)
    }
  }

  if (!isAsking) {
    return (
      <Button variant="danger" size="sm" className="self-start" onClick={() => setIsAsking(true)}>
        <Icon name="trash" size={14} />
        {t.remove}
      </Button>
    )
  }
  return (
    <div role="group" aria-label={t.remove} className="flex flex-col gap-3 rounded-[12px] border border-danger-line bg-danger-tint px-4 py-3">
      <span className="text-[14px] text-ink">{t.removeQuestion(skill.displayName)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" size="sm" disabled={isRemoving} onClick={() => void remove()}>
          {isRemoving ? t.removing : t.confirmRemove}
        </Button>
        {!isRemoving && (
          <Button variant="ghost" size="sm" onClick={() => setIsAsking(false)}>
            {cancelLabel}
          </Button>
        )}
      </div>
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Screen 68b · A skill's page: turn it on or off, change what it may use, see what the safety
 * check found, choose the agents that use it, review an update, and remove it.
 */
export function SkillDetailPage() {
  const t = useT().skills
  const { skillName = '' } = useParams()
  const page = useAsyncData(() => loadSkillPage(skillName), [skillName])
  const [changedSkill, setChangedSkill] = useState<InstalledSkill | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)
  const skill = changedSkill?.name === skillName ? changedSkill : (page.data?.skill ?? null)

  async function toggleEnabled(enabled: boolean) {
    setChangeError(null)
    try {
      setChangedSkill(await setSkillEnabled(skillName, enabled))
    } catch (error) {
      setChangeError(t.detail.couldNotChange(describeError(error)))
    }
  }

  const backLink = (
    <Link to={routePaths.skills} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:underline">
      <Icon name="arrowLeft" size={14} />
      {t.backToSkills}
    </Link>
  )

  if (!skill) {
    return (
      <AppShell activeNav="skills">
        <PageFrame>
          {backLink}
          {page.error ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {t.couldNotLoad(describeError(page.error))}
            </p>
          ) : (
            <p className="m-0 text-muted">{page.data ? t.detail.notFound : t.loading}</p>
          )}
        </PageFrame>
      </AppShell>
    )
  }

  const meta = [
    describeSkillSource(skill.source, skill.publisher),
    skill.version ? t.versionLabel(skill.version) : null,
    skill.installedAt ? t.detail.addedOn(formatDate(new Date(skill.installedAt))) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AppShell activeNav="skills">
      <PageFrame>
        <div className="flex flex-col gap-3">
          {backLink}
          <PageTitleBlock
            title={
              <span className="flex flex-wrap items-center gap-3">
                {skill.displayName}
                <Badge tone={skill.enabled ? 'ok' : 'neutral'}>{skill.enabled ? t.statusOn : t.statusOff}</Badge>
                {skill.verified && <Badge tone="brand">{t.checked}</Badge>}
              </span>
            }
            subtitle={meta}
          />
        </div>
        {page.data?.updateAvailable && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-line-2 bg-amber-tint px-4 py-3">
            <span className="text-[14px] text-ink">{t.detail.updateBanner}</span>
            <LinkButton to={skillAddPath(skill.name)} size="sm" className="!text-white">
              {t.update}
            </LinkButton>
          </div>
        )}
        <Card className="flex flex-col gap-4 p-5">
          <p className="m-0 max-w-[80ch] text-[15px] leading-relaxed text-ink">{skill.description}</p>
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-medium text-ink">
            <input type="checkbox" checked={skill.enabled} onChange={(event) => void toggleEnabled(event.target.checked)} className="size-4 shrink-0 accent-ink" />
            {t.detail.enabledLabel(skill.displayName)}
          </label>
          <span className="pl-[26px] text-[12px] text-muted">{t.detail.enabledHint}</span>
          {changeError && (
            <span role="alert" className="text-[13px] text-danger">
              {changeError}
            </span>
          )}
        </Card>
        <SectionCard heading={t.detail.agentsHeading}>
          {!skill.enabled && <p className="m-0 text-[13px] text-amber-strong">{t.agents.skillIsOff}</p>}
          <AgentSkillPicker skillName={skill.name} />
        </SectionCard>
        <PermissionsSection key={`${skill.name}-${skill.permissions.length}`} skill={skill} onSaved={setChangedSkill} />
        <SectionCard heading={t.detail.safetyHeading}>
          <SkillFindingsList findings={skill.findings} />
        </SectionCard>
        <RemoveSection skill={skill} />
      </PageFrame>
    </AppShell>
  )
}
