import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { PluginIcon } from '@/pages/plugins/PluginIcon'
import type { PaletteAction, PaletteLibrary, PalettePlugin } from './paletteCatalog'
import { PaletteOptionRow } from './PaletteOptionRow'
import { messages } from '@/i18n'

/** Actions a collapsed-to-preview plugin shows before "Show all N actions". */
export const pluginPreviewCount = 3

/** Which plugin groups are open and which show every action. */
export interface BrowseExpansion {
  expandedPlugins: ReadonlySet<string>
  showAllPlugins: ReadonlySet<string>
}

/** The actions a plugin shows right now (none when collapsed). */
export function visiblePluginActions(plugin: PalettePlugin, expansion: BrowseExpansion): PaletteAction[] {
  if (!expansion.expandedPlugins.has(plugin.name)) return []
  return expansion.showAllPlugins.has(plugin.name) ? plugin.actions : plugin.actions.slice(0, pluginPreviewCount)
}

/** Options in browse order, for keyboard navigation. */
export function visibleBrowseActions(library: PaletteLibrary, expansion: BrowseExpansion): PaletteAction[] {
  return [
    ...library.builtinGroups.flatMap((builtinGroup) => builtinGroup.actions),
    ...library.installedPlugins.flatMap((plugin) => visiblePluginActions(plugin, expansion)),
    ...library.catalogPlugins.flatMap((plugin) => visiblePluginActions(plugin, expansion)),
  ]
}

export interface PaletteRowHandlers {
  activeKind: string | null
  readOnly: boolean
  onSelect: (action: PaletteAction) => void
  onActivate: (action: PaletteAction) => void
  onDragKind: (action: PaletteAction | null) => void
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h3>
}

function describeActionCount(count: number): string {
  return count === 1 ? messages().nodes.n1Action : messages().nodes.countActions(count)
}

interface PluginGroupProps {
  plugin: PalettePlugin
  expansion: BrowseExpansion
  handlers: PaletteRowHandlers
  onToggle: (pluginName: string) => void
  onShowAll: (pluginName: string) => void
}

/** A collapsible plugin: "WhatsApp Web · 7 actions", most used first, "Show all 7 actions". */
function PluginGroup({ plugin, expansion, handlers, onToggle, onShowAll }: PluginGroupProps) {
  const isExpanded = expansion.expandedPlugins.has(plugin.name)
  const shownActions = visiblePluginActions(plugin, expansion)
  const listId = `palette-plugin-${plugin.name}`
  return (
    <li className={joinClassNames('flex flex-col rounded-xl', isExpanded && 'bg-subtle/70 pb-1')}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={listId}
        onClick={() => onToggle(plugin.name)}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-transparent px-2 py-1.5 text-left hover:bg-subtle"
      >
        <span aria-hidden="true" className={joinClassNames('w-3 text-[10px] text-muted transition-transform', isExpanded && 'rotate-90')}>
          ▶
        </span>
        <span className="flex shrink-0 [&>span]:!size-8 [&>span]:!rounded-lg [&>span]:!text-[11px]">
          <PluginIcon name={plugin.name} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-ink">{plugin.displayName}</span>
          <span className="text-[11px] text-muted">{describeActionCount(plugin.actions.length)}</span>
        </span>
        {!plugin.installed && <span className="shrink-0 text-[11px] text-muted">{messages().nodes.notInstalled2}</span>}
      </button>
      {isExpanded && (
        <ul id={listId} role="group" aria-label={messages().nodes.displaynameActions(plugin.displayName)} className="m-0 flex list-none flex-col gap-0.5 py-0 pl-7 pr-1">
          {plugin.installed && plugin.usageCount > 0 && <li role="presentation" className="px-2 pt-1 text-[11px] font-semibold text-muted">{messages().nodes.mostUsed}</li>}
          {shownActions.map((action) => (
            <PaletteOptionRow
              key={action.kind}
              action={action}
              variant="browse"
              showTile={false}
              isActive={handlers.activeKind === action.kind}
              isDisabled={handlers.readOnly}
              onSelect={handlers.onSelect}
              onActivate={handlers.onActivate}
              onDragKind={handlers.onDragKind}
            />
          ))}
          {shownActions.length < plugin.actions.length && (
            <li role="presentation">
              <button type="button" onClick={() => onShowAll(plugin.name)} className="cursor-pointer border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-ok-strong hover:underline">
                {messages().nodes.showAll}{' '}{describeActionCount(plugin.actions.length)}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

interface PaletteBrowseProps {
  library: PaletteLibrary
  expansion: BrowseExpansion
  handlers: PaletteRowHandlers
  onTogglePlugin: (pluginName: string) => void
  onShowAllPlugin: (pluginName: string) => void
}

/** Browse view (spec 34 / 38): Built-in by library group, Installed plugins, From the plugin catalog. */
export function PaletteBrowse({ library, expansion, handlers, onTogglePlugin, onShowAllPlugin }: PaletteBrowseProps) {
  const pluginSection = (title: string, plugins: PalettePlugin[]) =>
    plugins.length > 0 && (
      <section aria-label={title}>
        <SectionHeading>{title}</SectionHeading>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {plugins.map((plugin) => (
            <PluginGroup key={plugin.name} plugin={plugin} expansion={expansion} handlers={handlers} onToggle={onTogglePlugin} onShowAll={onShowAllPlugin} />
          ))}
        </ul>
      </section>
    )
  return (
    <>
      <section aria-label={messages().nodes.builtIn}>
        <SectionHeading>{messages().nodes.builtIn}</SectionHeading>
        {library.builtinGroups.map((builtinGroup) => (
          <div key={builtinGroup.group} className="flex flex-col">
            <h4 className="m-0 px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-faint">{builtinGroup.label}</h4>
            <ul role="group" aria-label={builtinGroup.label} className="m-0 flex list-none flex-col gap-0.5 p-0">
              {builtinGroup.actions.map((action) => (
                <PaletteOptionRow
                  key={action.kind}
                  action={action}
                  variant="browse"
                  isActive={handlers.activeKind === action.kind}
                  isDisabled={handlers.readOnly}
                  onSelect={handlers.onSelect}
                  onActivate={handlers.onActivate}
                  onDragKind={handlers.onDragKind}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
      {pluginSection(messages().nodes.installedPlugins, library.installedPlugins)}
      {pluginSection(messages().nodes.fromThePluginCatalog, library.catalogPlugins)}
    </>
  )
}
