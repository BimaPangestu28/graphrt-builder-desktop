import { useSearchParams } from 'react-router-dom'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Icon, LinkButton, PillTabBadge, pillTabClassNames } from '@/components/ui'
import { useSkillInventory, type SkillInventory } from '@/hooks/useSkills'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { routePaths } from '@/routes'
import { CatalogSkillCard, InstalledSkillCard } from './skills/SkillCard'
import { countAgentsUsing } from './skills/skillDisplay'

type SkillsTab = 'installed' | 'catalog'
const tabs: readonly SkillsTab[] = ['installed', 'catalog']
/** Search param holding the open tab, so a refresh and the wizard's back link keep it. */
const tabParam = 'tab'
const gridClassNames = 'm-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3'

function EmptyList({ message }: { message: string }) {
  return <p className="m-0 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center text-muted">{message}</p>
}

function SkillLists({ inventory, tab }: { inventory: SkillInventory; tab: SkillsTab }) {
  const t = useT().skills
  const catalogSkills = inventory.catalog?.skills ?? []
  if (tab === 'installed') {
    if (inventory.installed.length === 0) return <EmptyList message={t.emptyInstalled} />
    return (
      <ul aria-label={t.installedListLabel} className={gridClassNames}>
        {inventory.installed.map((skill) => (
          <li key={skill.name} className="min-w-0">
            <InstalledSkillCard
              skill={skill}
              agentCount={countAgentsUsing(inventory.agents, skill.name)}
              updateAvailable={catalogSkills.some((entry) => entry.name === skill.name && entry.updateAvailable)}
            />
          </li>
        ))}
      </ul>
    )
  }
  if (inventory.catalogError) {
    return (
      <p role="alert" className="m-0 text-[13px] text-danger">
        {t.couldNotLoadCatalog(describeError(inventory.catalogError))}
      </p>
    )
  }
  if (catalogSkills.length === 0) return <EmptyList message={t.emptyCatalog} />
  return (
    <div className="flex flex-col gap-3">
      {inventory.catalog?.fromCache && <p className="m-0 text-[13px] text-muted">{t.offlineCatalog}</p>}
      <ul aria-label={t.catalogListLabel} className={gridClassNames}>
        {catalogSkills.map((skill) => (
          <li key={skill.name} className="min-w-0">
            <CatalogSkillCard skill={skill} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Screen 68 · Skills. What the agents were taught: "Your skills" (added from the catalog or
 * written here) and "From the catalog", as equal-height cards in two or three columns. Adding
 * and creating are wizards (`/skills/add/:skillName`, `/skills/new`); a card opens the
 * skill's page for what it may use, which agents use it, and Remove.
 */
export function SkillsPage() {
  const t = useT().skills
  const inventory = useSkillInventory()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: SkillsTab = searchParams.get(tabParam) === 'catalog' ? 'catalog' : 'installed'
  const counts: Record<SkillsTab, number | null> = {
    installed: inventory.data?.installed.length ?? null,
    catalog: inventory.data?.catalog?.skills.length ?? null,
  }

  return (
    <AppShell activeNav="skills">
      <PageFrame>
        <PageTitleBlock
          title={t.title}
          subtitle={t.subtitle}
          actions={
            <LinkButton to={routePaths.skillCreate} className="!text-inverse">
              <Icon name="plus" size={16} />
              {t.createSkill}
            </LinkButton>
          }
        />
        <div role="tablist" aria-label={t.tabsLabel} className="flex flex-wrap gap-2">
          {tabs.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              onClick={() => setSearchParams(candidate === 'installed' ? {} : { [tabParam]: candidate }, { replace: true })}
              className={pillTabClassNames(tab === candidate)}
            >
              {t.tabs[candidate]}
              {/* Keeps the accessible name "Installed 2", not "Installed2". */}
              {counts[candidate] !== null && ' '}
              {counts[candidate] !== null && <PillTabBadge isActive={tab === candidate}>{counts[candidate]}</PillTabBadge>}
            </button>
          ))}
        </div>
        {inventory.error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {t.couldNotLoad(describeError(inventory.error))}
          </p>
        )}
        {!inventory.error && !inventory.data && <p className="m-0 text-muted">{t.loading}</p>}
        {inventory.data && <SkillLists inventory={inventory.data} tab={tab} />}
      </PageFrame>
    </AppShell>
  )
}
