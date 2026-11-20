import { Icon, joinClassNames } from '@/components/ui'
import { pluginCategoryLabels, type PluginCategory } from './pluginCategories'
import type { PluginFilter } from './pluginDisplay'

const tabLabels: Record<PluginFilter, string> = { all: 'All', installed: 'Installed', updates: 'Updates', attention: 'Needs attention' }
const tabOrder: PluginFilter[] = ['all', 'installed', 'updates', 'attention']

function pillClassNames(isActive: boolean, size: 'md' | 'sm'): string {
  return joinClassNames(
    'inline-flex cursor-pointer items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
    size === 'md' ? 'h-[34px] px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
    isActive ? 'border border-ink bg-ink text-white' : 'border border-line-strong bg-surface text-ink hover:bg-subtle',
  )
}

/** Small count after a tab label; amber for updates and attention so they stand out. */
function TabCount({ filter, count, isActive }: { filter: PluginFilter; count: number; isActive: boolean }) {
  const isWarning = (filter === 'updates' || filter === 'attention') && count > 0 && !isActive
  return (
    <span className={joinClassNames('rounded-full px-1.5 text-[11px] font-semibold', isActive ? 'bg-white/20' : isWarning ? 'bg-amber-soft text-amber-strong' : 'bg-chip text-ink-2')}>
      {count}
    </span>
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
    <div role="group" aria-label="Show plugins" className="flex flex-wrap gap-1.5">
      {tabOrder.map((filter) => (
        <button key={filter} type="button" aria-pressed={activeFilter === filter} onClick={() => onChange(filter)} className={pillClassNames(activeFilter === filter, 'md')}>
          {tabLabels[filter]}
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
        aria-label="Search plugins"
        placeholder="Search plugins or steps"
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
    <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
      <button type="button" aria-pressed={activeCategory === null} onClick={() => onChange(null)} className={pillClassNames(activeCategory === null, 'sm')}>
        Any category
      </button>
      {categoryCounts.map(({ category, count }) => (
        <button
          key={category}
          type="button"
          aria-pressed={activeCategory === category}
          onClick={() => onChange(activeCategory === category ? null : category)}
          className={pillClassNames(activeCategory === category, 'sm')}
        >
          {pluginCategoryLabels[category]}
          <span className={activeCategory === category ? 'text-white/70' : 'text-muted'}>{count}</span>
        </button>
      ))}
    </div>
  )
}
