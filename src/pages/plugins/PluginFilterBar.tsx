import { Icon, PillTabBadge, pillTabClassNames } from '@/components/ui'
import { pluginCategoryLabels, type PluginCategory } from './pluginCategories'
import type { PluginFilter } from './pluginDisplay'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

const tabLabels: Readonly<Record<PluginFilter, string>> = localizedRecord(() => messages().plugins.tabs)
const tabOrder: PluginFilter[] = ['all', 'installed', 'updates', 'attention']

/** Small count after a tab label; amber for updates and attention so they stand out. */
function TabCount({ filter, count, isActive }: { filter: PluginFilter; count: number; isActive: boolean }) {
  const isWarning = (filter === 'updates' || filter === 'attention') && count > 0
  return (
    <PillTabBadge isActive={isActive} isWarning={isWarning}>
      {count}
    </PillTabBadge>
  )
}

interface PluginTabsProps {
  activeFilter: PluginFilter
  counts: Record<PluginFilter, number>
  onChange: (filter: PluginFilter) => void
}

/** All · Installed · Updates · Needs attention, each with its count. */
export function PluginTabs({ activeFilter, counts, onChange }: PluginTabsProps) {
  return (
    <div role="group" aria-label={messages().plugins.showPlugins} className="flex flex-wrap gap-1.5">
      {tabOrder.map((filter) => (
        <button key={filter} type="button" aria-pressed={activeFilter === filter} onClick={() => onChange(filter)} className={pillTabClassNames(activeFilter === filter, 'md')}>
          {tabLabels[filter]}
          {/* Keeps the accessible name "All 9", not "All9" (whitespace adds no flex item). */}{' '}
          <TabCount filter={filter} count={counts[filter]} isActive={activeFilter === filter} />
        </button>
      ))}
    </div>
  )
}

export function PluginSearchBox({ searchText, onChange }: { searchText: string; onChange: (searchText: string) => void }) {
  return (
    <label className="box-border flex h-[34px] w-[260px] max-w-full items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-muted focus-within:border-ink">
      <Icon name="search" size={15} />
      <input
        type="search"
        aria-label={messages().plugins.searchPlugins}
        placeholder={messages().plugins.searchPlaceholder}
        value={searchText}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none"
      />
    </label>
  )
}

interface PluginCategoryChipsProps {
  /** Categories present in the current results, with their counts, in display order. */
  categoryCounts: Array<{ category: PluginCategory; count: number }>
  activeCategory: PluginCategory | null
  onChange: (category: PluginCategory | null) => void
}

/** "Any category" plus one chip per category; hidden when everything is in one category. */
export function PluginCategoryChips({ categoryCounts, activeCategory, onChange }: PluginCategoryChipsProps) {
  if (categoryCounts.length < 2 && activeCategory === null) return null
  return (
    <div role="group" aria-label={messages().plugins.categoryGroup} className="flex flex-wrap gap-1.5">
      <button type="button" aria-pressed={activeCategory === null} onClick={() => onChange(null)} className={pillTabClassNames(activeCategory === null, 'sm')}>
        {messages().plugins.anyCategory}
      </button>
      {categoryCounts.map(({ category, count }) => (
        <button
          key={category}
          type="button"
          aria-pressed={activeCategory === category}
          onClick={() => onChange(activeCategory === category ? null : category)}
          className={pillTabClassNames(activeCategory === category, 'sm')}
        >
          {pluginCategoryLabels[category]}
          <span className={activeCategory === category ? 'text-white/70' : 'text-muted'}>{count}</span>
        </button>
      ))}
    </div>
  )
}
