import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { PluginPermissions } from '@/api/pluginTypes'
import { Icon } from '@/components/ui'
import { usePlugins } from '@/hooks/usePlugins'
import type { AddNodePaletteProps } from './contracts'
import { buildNodePlacement, describeAnchor, validAnchor } from './palette/nodePlacement'
import { PaletteBrowse, visibleBrowseActions, type BrowseExpansion, type PaletteRowHandlers } from './palette/PaletteBrowse'
import { buildPaletteLibrary, type PaletteAction } from './palette/paletteCatalog'
import { paletteOptionId } from './palette/PaletteOptionRow'
import { searchPaletteActions } from './palette/paletteSearch'
import { PaletteSearchResults, visibleSearchResults } from './palette/PaletteSearchResults'
import { PluginInstallPrompt } from './palette/PluginInstallPrompt'
import { usePaletteInstall, type PaletteInstallState } from './palette/usePaletteInstall'
import { usePaletteNavigation } from './palette/usePaletteNavigation'
import { usePaletteUsage } from './palette/usePaletteUsage'

/** Width of the floating palette (spec 34: 300px); the canvas fits clear of it. */
export const paletteWidth = 300

/**
 * The Add node palette (spec C, C2, N1; artboards 34, 38): browse built-in steps by library
 * group, installed plugins (most used actions first) and catalog plugins; search all of them
 * with ↑ ↓ Enter Esc; click or Enter adds after the anchor (selected node, context node or
 * arrow), dragging puts a step on the canvas or on an arrow. A catalog action opens an
 * install approval first; nothing installs without that OK.
 */
export function AddNodePalette(props: AddNodePaletteProps) {
  // Kept while closed: plugins installed here stay "Installed" until the library reloads.
  const install = usePaletteInstall(props.onPluginInstalled)
  if (!props.isOpen) return null
  return <AddNodePalettePanel {...props} install={install} />
}

/** What a plugin gets when the prompt could not show its catalog entry: nothing. */
const noPermissions: PluginPermissions = { network: false, secrets: false, env: [] }

function useBrowseExpansion(firstInstalledPlugin: string | null) {
  const [expandedPlugins, setExpandedPlugins] = useState<ReadonlySet<string>>(() => new Set(firstInstalledPlugin ? [firstInstalledPlugin] : []))
  const [showAllPlugins, setShowAllPlugins] = useState<ReadonlySet<string>>(new Set())
  const expansion: BrowseExpansion = { expandedPlugins, showAllPlugins }
  function togglePlugin(pluginName: string) {
    setExpandedPlugins((previous) => {
      const next = new Set(previous)
      if (next.has(pluginName)) next.delete(pluginName)
      else next.add(pluginName)
      return next
    })
  }
  const showAllOfPlugin = (pluginName: string) => setShowAllPlugins((previous) => new Set([...previous, pluginName]))
  return { expansion, togglePlugin, showAllOfPlugin }
}

function AddNodePalettePanel({
  nodeKinds,
  graph,
  readOnly,
  onAddNode,
  onClose,
  anchor = null,
  insertAfter = null,
  positions = {},
  onPlaceNode,
  requestedKind = null,
  onDragKindChange,
  install,
}: AddNodePaletteProps & { install: PaletteInstallState }) {
  const plugins = usePlugins()
  const usageByKind = usePaletteUsage()
  const catalogEntries = plugins.data?.catalog?.plugins
  const library = useMemo(
    () => buildPaletteLibrary(nodeKinds, { graph, usageByKind, catalogEntries, installedPluginNames: install.installedPluginNames }),
    [nodeKinds, graph, usageByKind, catalogEntries, install.installedPluginNames],
  )
  const [query, setQuery] = useState('')
  const [showsAllResults, setShowsAllResults] = useState(false)
  const { expansion, togglePlugin, showAllOfPlugin } = useBrowseExpansion(library.installedPlugins[0]?.name ?? null)
  const searchResults = useMemo(() => searchPaletteActions(library.allActions, query), [library, query])
  const isSearching = query.trim().length > 0
  const shownResults = visibleSearchResults(searchResults, showsAllResults)
  const visibleOptions = isSearching ? shownResults.map((result) => result.action) : visibleBrowseActions(library, expansion)
  const navigation = usePaletteNavigation(visibleOptions)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // `insertAfter` (canvas "Add node after", phase-2 contract) stands in when no anchor is given.
  const currentAnchor = validAnchor(graph, anchor ?? (insertAfter ? { type: 'after-exit', source: insertAfter.source, sourceHandle: insertAfter.sourceHandle } : null))
  const placementText = describeAnchor(graph, currentAnchor)

  function addAction(action: PaletteAction, actionAnchor = currentAnchor) {
    const placement = buildNodePlacement(graph, action, actionAnchor, positions)
    if (onPlaceNode) onPlaceNode(placement)
    else onAddNode(placement.node, { position: placement.layout ?? undefined })
    onClose()
  }

  function selectAction(action: PaletteAction) {
    if (readOnly) return
    if (action.plugin && !action.plugin.installed) install.requestInstall(action, currentAnchor)
    else addAction(action)
  }

  async function confirmInstall(withPluginRuntime: boolean) {
    const pendingEntry = catalogEntries?.find((entry) => entry.name === install.pending?.action.plugin?.name)
    // Without the catalog entry the prompt says the plugin gets no settings or secrets: approve exactly that.
    const installed = await install.confirm(pendingEntry?.permissions ?? noPermissions, withPluginRuntime)
    if (installed) addAction(installed.action, validAnchor(graph, installed.anchor))
  }

  // A not-installed action dropped on the canvas: open its approval (never install silently).
  const handledRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!requestedKind || handledRequest.current === requestedKind.requestId) return
    const action = library.allActions.find((candidate) => candidate.kind === requestedKind.kind)
    if (!action) return
    handledRequest.current = requestedKind.requestId
    if (action.plugin && !action.plugin.installed) install.requestInstall(action, requestedKind.anchor)
  }, [requestedKind, library])

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      navigation.moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (navigation.activeAction) selectAction(navigation.activeAction)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (install.pending && !install.isInstalling) install.cancel()
      else onClose()
    }
  }

  const handlers: PaletteRowHandlers = {
    activeKind: navigation.activeKind,
    readOnly,
    onSelect: selectAction,
    onActivate: (action) => navigation.setActiveKind(action.kind),
    onDragKind: (action) => onDragKindChange?.(action?.kind ?? null),
  }
  const pendingPluginName = install.pending?.action.plugin?.name ?? null

  return (
    <aside
      aria-label="Add node"
      className="absolute bottom-3 left-3 top-3 z-10 box-border flex w-[min(300px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_28px_rgba(0,0,0,0.10)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
      }}
    >
      <header className="flex items-start justify-between gap-2 px-4 pb-2 pt-3.5">
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-[14px] font-semibold text-ink">Add node</h2>
          <span className="truncate text-[12px] text-muted">{isSearching ? 'Searching' : `Adds ${placementText}`}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Add node" className="flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-subtle text-muted hover:bg-chip">
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="px-4 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 focus-within:border-ink">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            ref={searchInputRef}
            autoFocus
            role="combobox"
            aria-label="Search steps, plugins and actions"
            aria-expanded="true"
            aria-controls="palette-options"
            aria-activedescendant={navigation.activeKind ? paletteOptionId(navigation.activeKind) : undefined}
            aria-autocomplete="list"
            placeholder="Search steps, plugins and actions"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setShowsAllResults(false)
              navigation.setActiveKind(null)
            }}
            onKeyDown={handleSearchKeyDown}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      {readOnly && <p className="m-0 mx-4 mb-2 rounded-lg bg-subtle px-2.5 py-2 text-[12px] text-muted">The builder is changing this agent. You can add steps when it finishes.</p>}
      {install.pending && (
        <div className="px-4 pb-2">
          <PluginInstallPrompt
            pending={install.pending}
            placementText={describeAnchor(graph, validAnchor(graph, install.pending.anchor))}
            catalogEntry={catalogEntries?.find((entry) => entry.name === pendingPluginName) ?? null}
            isInstalling={install.isInstalling}
            progress={pendingPluginName ? (plugins.progressByName[pendingPluginName] ?? null) : null}
            errorMessage={install.errorMessage}
            onConfirm={(withPluginRuntime) => void confirmInstall(withPluginRuntime)}
            onCancel={() => {
              install.cancel()
              searchInputRef.current?.focus()
            }}
          />
        </div>
      )}
      <div id="palette-options" role="listbox" aria-label={isSearching ? 'Search results' : 'Steps and plugin actions'} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isSearching ? (
          <PaletteSearchResults query={query} results={searchResults} showsAll={showsAllResults} handlers={handlers} onShowAll={() => setShowsAllResults(true)} />
        ) : (
          <PaletteBrowse library={library} expansion={expansion} handlers={handlers} onTogglePlugin={togglePlugin} onShowAllPlugin={showAllOfPlugin} />
        )}
      </div>
      <p className="m-0 border-t border-line bg-subtle/60 px-4 py-2.5 text-[12px] leading-normal text-muted">
        {isSearching
          ? `Enter adds the highlighted step ${placementText}. Not installed ones ask for your OK before they install`
          : 'Drag a step onto the canvas, or onto an arrow to put it between two steps. Catalog plugins install only after you approve what they ask for'}
      </p>
    </aside>
  )
}
