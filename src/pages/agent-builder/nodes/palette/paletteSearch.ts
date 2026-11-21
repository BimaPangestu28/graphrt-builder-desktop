import type { PaletteAction } from './paletteCatalog'

/**
 * Palette search over built-in kinds and plugin actions: every word of the query must match
 * the name, plugin, kind or description; name matches rank above the rest, installed above
 * not installed (spec "installed first"), then palette order.
 */

export interface PaletteSearchResult {
  action: PaletteAction
  score: number
  /** `[start, end)` ranges of the name to highlight. */
  nameHighlights: Array<[number, number]>
}

function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || /[\s._\-›>/]/.test(text[index - 1])
}

/** Best score of one word against one action, 0 when it matches nothing. */
function scoreWord(action: PaletteAction, word: string): number {
  const name = action.displayName.toLowerCase()
  const nameIndex = name.indexOf(word)
  if (name === word) return 100
  if (nameIndex === 0) return 80
  if (nameIndex > 0 && isWordStart(name, nameIndex)) return 60
  if (nameIndex > 0) return 40
  const pluginName = action.plugin?.displayName.toLowerCase() ?? ''
  if (pluginName.includes(word)) return 30
  if (action.kind.toLowerCase().includes(word)) return 20
  if (action.description.toLowerCase().includes(word)) return 10
  return 0
}

function highlightRanges(displayName: string, words: string[]): Array<[number, number]> {
  const lowerName = displayName.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const word of words) {
    const index = lowerName.indexOf(word)
    if (index >= 0) ranges.push([index, index + word.length])
  }
  ranges.sort((first, second) => first[0] - second[0])
  // Merge overlapping ranges so the name renders once.
  return ranges.reduce<Array<[number, number]>>((merged, range) => {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
    return merged
  }, [])
}

function isAvailable(action: PaletteAction): boolean {
  return !action.plugin || action.plugin.installed
}

/**
 * Searches the palette's actions.
 *
 * @param actions - Every offered action in palette order (`PaletteLibrary.allActions`)
 * @param query - What was typed (string)
 * @returns Matches, best first; empty for a blank query (PaletteSearchResult[])
 *
 * @example
 * searchPaletteActions(library.allActions, 'send')[0].action.displayName // 'Send WhatsApp message'
 */
export function searchPaletteActions(actions: PaletteAction[], query: string): PaletteSearchResult[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const results: Array<PaletteSearchResult & { order: number }> = []
  actions.forEach((action, order) => {
    const wordScores = words.map((word) => scoreWord(action, word))
    if (wordScores.some((wordScore) => wordScore === 0)) return
    const score = wordScores.reduce((total, wordScore) => total + wordScore, 0)
    results.push({ action, score, nameHighlights: highlightRanges(action.displayName, words), order })
  })
  results.sort(
    (first, second) => second.score - first.score || Number(isAvailable(second.action)) - Number(isAvailable(first.action)) || first.order - second.order,
  )
  return results.map(({ action, score, nameHighlights }) => ({ action, score, nameHighlights }))
}

/** "54 actions in 27 plugins · installed first", "3 steps", "No matches". */
export function describeSearchSummary(results: PaletteSearchResult[]): string {
  if (results.length === 0) return 'No matches'
  const pluginNames = new Set(results.flatMap((result) => (result.action.plugin ? [result.action.plugin.name] : [])))
  const builtinCount = results.length - results.filter((result) => result.action.plugin).length
  const parts: string[] = []
  if (builtinCount > 0) parts.push(builtinCount === 1 ? '1 step' : `${builtinCount} steps`)
  const actionCount = results.length - builtinCount
  if (actionCount > 0) parts.push(`${actionCount === 1 ? '1 action' : `${actionCount} actions`} in ${pluginNames.size === 1 ? '1 plugin' : `${pluginNames.size} plugins`}`)
  return `${parts.join(' and ')} · installed first`
}
