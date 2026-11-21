import type { PaletteRowHandlers } from './PaletteBrowse'
import { PaletteOptionRow } from './PaletteOptionRow'
import { describeSearchSummary, type PaletteSearchResult } from './paletteSearch'

/** Results shown before "Show all N results". */
export const searchPreviewCount = 12

interface PaletteSearchResultsProps {
  query: string
  results: PaletteSearchResult[]
  showsAll: boolean
  handlers: PaletteRowHandlers
  onShowAll: () => void
}

/** The results a search shows right now, for keyboard navigation. */
export function visibleSearchResults(results: PaletteSearchResult[], showsAll: boolean): PaletteSearchResult[] {
  return showsAll ? results : results.slice(0, searchPreviewCount)
}

/** Search view (spec 38 "Searching"): "Plugin › action" rows, installed first, matches highlighted. */
export function PaletteSearchResults({ query, results, showsAll, handlers, onShowAll }: PaletteSearchResultsProps) {
  if (results.length === 0) {
    return (
      <div role="status" className="flex flex-col items-center gap-1 px-4 py-10 text-center">
        <span className="text-[13px] font-semibold text-ink">Nothing matches “{query.trim()}”</span>
        <span className="text-[12px] leading-normal text-muted">Try another word, like “send”, “model” or “list”. Plugins not in the catalog can be added in Plugins.</span>
      </div>
    )
  }
  const shownResults = visibleSearchResults(results, showsAll)
  return (
    <section aria-label="Search results" className="flex flex-col gap-0.5">
      <p role="status" className="m-0 px-2 pb-1 pt-2 text-[12px] text-muted">
        {describeSearchSummary(results)}
      </p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {shownResults.map((result) => (
          <PaletteOptionRow
            key={result.action.kind}
            action={result.action}
            variant="result"
            highlights={result.nameHighlights}
            isActive={handlers.activeKind === result.action.kind}
            isDisabled={handlers.readOnly}
            onSelect={handlers.onSelect}
            onActivate={handlers.onActivate}
            onDragKind={handlers.onDragKind}
          />
        ))}
      </ul>
      {shownResults.length < results.length && (
        <button type="button" onClick={onShowAll} className="cursor-pointer self-start border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-ok-strong hover:underline">
          Show all {results.length} results
        </button>
      )}
    </section>
  )
}
