import { sampleNodeKinds } from '@/api/sampleBackend/sampleNodeKinds'
import type { NodeKindInfo } from '@/api/agentGraphTypes'
import type { PluginCatalogEntry } from '@/api/pluginTypes'
import { buildPaletteLibrary, countKindUsage, excludedPaletteKinds } from '../paletteCatalog'
import { describeSearchSummary, searchPaletteActions } from '../paletteSearch'

const graphWithStart = { nodes: [{ kind: 'start' }] } as Parameters<typeof buildPaletteLibrary>[1]['graph']
const emptyGraph = { nodes: [] } as unknown as Parameters<typeof buildPaletteLibrary>[1]['graph']

function kindsOf(library: ReturnType<typeof buildPaletteLibrary>): string[] {
  return library.allActions.map((action) => action.kind)
}

function libraryKind(kind: string, overrides: Partial<NodeKindInfo> = {}): NodeKindInfo {
  const base = sampleNodeKinds.find((kindInfo) => kindInfo.kind === 'llm')!
  return { ...base, kind, displayName: kind, offered: true, group: 'other', ...overrides }
}

describe('palette library', () => {
  it('groups built-in kinds by library group, then installed and catalog plugins', () => {
    const library = buildPaletteLibrary(sampleNodeKinds, { graph: graphWithStart })
    expect(library.builtinGroups.map((builtinGroup) => builtinGroup.label)).toEqual(['AI', 'Connect', 'Decide and wait', 'Repeat', 'Data', 'Start and finish'])
    expect(library.builtinGroups[0].actions.map((action) => action.displayName)).toEqual(['Ask a model', 'Run an agent', 'Sort into categories', 'Pull out details', 'Knowledge retrieval'])
    expect(library.installedPlugins.map((plugin) => [plugin.displayName, plugin.actions.length])).toEqual([
      ['Google Maps Scraper', 1],
      ['WhatsApp Web', 2],
    ])
    expect(library.catalogPlugins.map((plugin) => [plugin.name, plugin.installed])).toEqual([['telegram-bot', false]])
  })

  it('never offers excluded kinds, markers, variable-assigner or a second Start', () => {
    const smuggled = ['code', 'document-extractor', 'system-one', 'iteration-start', 'loop-start', 'variable-assigner'].map((kind) => libraryKind(kind))
    const library = buildPaletteLibrary([...sampleNodeKinds, ...smuggled], { graph: graphWithStart })
    for (const kind of excludedPaletteKinds) expect(kindsOf(library)).not.toContain(kind)
    expect(kindsOf(library)).not.toContain('start')
    expect(kindsOf(buildPaletteLibrary(sampleNodeKinds, { graph: emptyGraph }))).toContain('start')
  })

  it('puts the most used installed plugins and actions first, else keeps catalog order', () => {
    const usageByKind = countKindUsage([
      'nodes:\n  - id: a\n    type: whatsapp-web.get_status\n  - id: b\n    type: whatsapp-web.get_status\n',
      'nodes:\n  - id: c\n    type: "whatsapp-web.get_status"\n  - id: d\n    type: llm\n',
    ])
    expect(usageByKind).toEqual({ 'whatsapp-web.get_status': 3 })
    const library = buildPaletteLibrary(sampleNodeKinds, { graph: graphWithStart, usageByKind })
    expect(library.installedPlugins[0].name).toBe('whatsapp-web')
    expect(library.installedPlugins[0].actions.map((action) => action.kind)).toEqual(['whatsapp-web.get_status', 'whatsapp-web.send_message'])
    expect(library.installedPlugins[0].usageCount).toBe(3)
  })

  it('adds catalog actions the library lacks as not installed, and treats palette installs as installed', () => {
    const catalogEntry = {
      name: 'email',
      displayName: 'Email',
      installedVersion: null,
      nodes: [{ kind: 'email.send', title: 'Send email', description: 'Sends an email' }],
    } as unknown as PluginCatalogEntry
    const library = buildPaletteLibrary(sampleNodeKinds, { graph: graphWithStart, catalogEntries: [catalogEntry], installedPluginNames: new Set(['telegram-bot']) })
    expect(library.catalogPlugins.map((plugin) => plugin.name)).toEqual(['email'])
    expect(library.catalogPlugins[0].actions[0]).toMatchObject({ kind: 'email.send', kindInfo: null, plugin: { installed: false } })
    expect(library.installedPlugins.map((plugin) => plugin.name)).toContain('telegram-bot')
  })
})

describe('palette search', () => {
  const library = buildPaletteLibrary(sampleNodeKinds, { graph: graphWithStart })

  it('ranks name matches first and installed actions above not installed ones', () => {
    const results = searchPaletteActions(library.allActions, 'send')
    expect(results.map((result) => result.action.kind).slice(0, 2)).toEqual(['whatsapp-web.send_message', 'telegram-bot.send_message'])
    // "Sends a prompt…" only matches the description, so Ask a model comes after the name matches.
    const askModelIndex = results.findIndex((result) => result.action.kind === 'llm')
    expect(askModelIndex).toBeGreaterThan(1)
    expect(results[0].nameHighlights).toEqual([[0, 4]])
    expect(describeSearchSummary(results)).toMatch(/2 actions in 2 plugins · installed first$/)
  })

  it('matches every word across plugin name and action, case-insensitively', () => {
    const results = searchPaletteActions(library.allActions, 'whatsapp STATUS')
    expect(results.map((result) => result.action.kind)).toEqual(['whatsapp-web.get_status'])
    expect(results[0].nameHighlights).toEqual([[0, 8], [9, 15]])
  })

  it('finds nothing for unknown words and blank queries', () => {
    expect(searchPaletteActions(library.allActions, 'zebra')).toEqual([])
    expect(searchPaletteActions(library.allActions, '   ')).toEqual([])
    expect(describeSearchSummary([])).toBe('No matches')
  })
})
