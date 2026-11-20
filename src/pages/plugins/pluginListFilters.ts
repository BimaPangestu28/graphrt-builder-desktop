import { pluginCategoryOrder, type PluginCategory } from './pluginCategories'
import { filterPluginListItems, filterPluginsByTab, type PluginFilter, type PluginListItem } from './pluginDisplay'

/** What the Plugins page is filtered by; kept in the URL (`?tab=&q=&category=`). */
export interface PluginListFilters {
  tab: PluginFilter
  searchText: string
  category: PluginCategory | null
}

const pluginFilters: PluginFilter[] = ['all', 'installed', 'updates', 'attention']

/**
 * Reads the filters from the page's search params; unknown values fall back to "all" / none.
 *
 * @example
 * readPluginListFilters(new URLSearchParams('tab=updates&q=mail')) // { tab: 'updates', searchText: 'mail', category: null }
 */
export function readPluginListFilters(searchParams: URLSearchParams): PluginListFilters {
  const tabParam = searchParams.get('tab')
  const categoryParam = searchParams.get('category')
  return {
    tab: pluginFilters.find((filter) => filter === tabParam) ?? 'all',
    searchText: searchParams.get('q') ?? '',
    category: pluginCategoryOrder.find((category) => category === categoryParam) ?? null,
  }
}

/** The search params for some filters; defaults are left out so the plain URL stays `/plugins`. */
export function writePluginListFilters(filters: PluginListFilters): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (filters.tab !== 'all') searchParams.set('tab', filters.tab)
  if (filters.searchText) searchParams.set('q', filters.searchText)
  if (filters.category) searchParams.set('category', filters.category)
  return searchParams
}

/** Applies tab and search (not the category): what the category chips count. */
export function applyTabAndSearch(items: PluginListItem[], filters: PluginListFilters): PluginListItem[] {
  return filterPluginListItems(filterPluginsByTab(items, filters.tab), filters.searchText)
}

/** Categories present in `items`, with counts, in chip order. */
export function countPluginCategories(items: PluginListItem[]): Array<{ category: PluginCategory; count: number }> {
  return pluginCategoryOrder
    .map((category) => ({ category, count: items.filter((item) => item.category === category).length }))
    .filter((categoryCount) => categoryCount.count > 0)
}
