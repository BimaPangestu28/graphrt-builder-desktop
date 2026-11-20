import type { InstalledPlugin, PluginCatalog } from '@/api/pluginTypes'
import { describeBrowserRuntimeEvent } from '@/hooks/useBrowserRuntime'
import {
  buildPluginListItems,
  describeInstallProgress,
  describePermissionChips,
  describePluginPermissions,
  describeStepCount,
  filterPluginListItems,
  pluginNeedsAttention,
} from './pluginDisplay'

const noPermissions = { network: false, secrets: false, env: [] }

function catalogWith(...names: string[]): PluginCatalog {
  return {
    plugins: names.map((name) => ({
      name,
      version: '1.0.0',
      description: name,
      permissions: noPermissions,
      needsBrowser: false,
      nodes: [],
      tools: [],
      readmeUrl: null,
      iconUrl: null,
      warning: null,
      status: null,
      tosRisk: null,
      sizeBytes: 1,
      installedVersion: null,
      updateAvailable: false,
      updateNeedsApproval: false,
    })),
    generatedAt: null,
    fromCache: false,
  }
}

function installed(name: string): InstalledPlugin {
  return {
    name,
    version: '0.1.0',
    description: name,
    permissions: noPermissions,
    trusted: false,
    needsBrowser: false,
    nodes: [],
    tools: [],
    config: [],
    loadError: null,
    warnings: [],
    readmeUrl: null,
    iconUrl: null,
  }
}

describe('buildPluginListItems', () => {
  it('carries the icon link from the catalog, else from the installed copy', () => {
    const catalog = catalogWith('alpha', 'beta')
    catalog.plugins[0].iconUrl = 'https://example.test/alpha.svg'
    const installedBeta = { ...installed('beta'), iconUrl: 'https://example.test/beta.svg' }
    const installedOnly = { ...installed('local-only'), iconUrl: null }

    const items = buildPluginListItems(catalog, [installedBeta, installedOnly])

    expect(Object.fromEntries(items.map((item) => [item.name, item.iconUrl]))).toEqual({
      alpha: 'https://example.test/alpha.svg',
      beta: 'https://example.test/beta.svg',
      'local-only': null,
    })
  })

  it('puts installed plugins first and keeps ones the catalog does not list', () => {
    const items = buildPluginListItems(catalogWith('alpha', 'beta'), [installed('beta'), installed('local-only')])
    expect(items.map((item) => [item.name, item.installed !== null])).toEqual([
      ['beta', true],
      ['local-only', true],
      ['alpha', false],
    ])
  })

  it('lists installed plugins without a catalog', () => {
    expect(buildPluginListItems(null, [installed('beta')]).map((item) => item.name)).toEqual(['beta'])
  })
})

describe('plugin display text', () => {
  it('describes permissions in plain language', () => {
    expect(describePluginPermissions({ network: false, secrets: true, env: ['A', 'B'] }, true)).toEqual([
      'Works without the internet',
      'Receives secret values in plain text (only once you trust it)',
      'Reads these settings: A, B',
      'Needs the browser runtime (Chromium) on this computer',
    ])
  })

  it('describes install progress', () => {
    expect(describeInstallProgress({ stage: 'downloading', percent: 40, message: null })).toBe('Downloading · 40%')
    expect(describeInstallProgress({ stage: 'verifying', percent: 100, message: null })).toBe('Checking the download…')
    expect(describeInstallProgress({ stage: 'failed', percent: null, message: 'checksum mismatch' })).toBe('Install failed · checksum mismatch')
  })

  it('reads only message and percent from browser runtime events', () => {
    expect(describeBrowserRuntimeEvent({ message: 'Downloading Chromium', percent: 39.6 })).toBe('Downloading Chromium · 40%')
    expect(describeBrowserRuntimeEvent({ percent: 10 })).toBe('10%')
    expect(describeBrowserRuntimeEvent({ stage: 'other' })).toBeNull()
    expect(describeBrowserRuntimeEvent('text')).toBeNull()
  })
})

describe('plugin row helpers', () => {
  it('summarizes permissions as short chips', () => {
    expect(describePermissionChips({ network: true, secrets: true, env: ['A', 'B'] }, true)).toEqual(['Internet', 'Secrets', '2 settings', 'Browser'])
    expect(describePermissionChips({ network: false, secrets: false, env: ['A'] }, false)).toEqual(['1 setting'])
    expect(describePermissionChips(noPermissions, false)).toEqual([])
  })

  it('counts the steps a plugin adds', () => {
    expect(describeStepCount(1)).toBe('Adds 1 step')
    expect(describeStepCount(14)).toBe('Adds 14 steps')
  })

  it('filters by name or description, ignoring case and surrounding spaces', () => {
    const items = buildPluginListItems(catalogWith('alpha', 'beta'), [])
    expect(filterPluginListItems(items, '  ALP ').map((item) => item.name)).toEqual(['alpha'])
    expect(filterPluginListItems(items, '')).toBe(items)
    expect(filterPluginListItems(items, 'gamma')).toEqual([])
  })

  it('flags installed plugins missing a required setting, but not an optional one', () => {
    const trustedPlugin = { ...installed('configured'), trusted: true }
    expect(pluginNeedsAttention({ ...trustedPlugin, config: [{ name: 'TOKEN', configured: false, optional: false }] })).toBe(true)
    expect(pluginNeedsAttention({ ...trustedPlugin, config: [{ name: 'IDLE_MINUTES', configured: false, optional: true }] })).toBe(false)
    expect(pluginNeedsAttention({ ...trustedPlugin, config: [{ name: 'TOKEN', configured: true, optional: false }] })).toBe(false)
  })

  it('flags plugins that failed to load, need trust, or have warnings', () => {
    expect(pluginNeedsAttention(installed('ready'))).toBe(false)
    expect(pluginNeedsAttention({ ...installed('broken'), loadError: 'checksum mismatch' })).toBe(true)
    expect(pluginNeedsAttention({ ...installed('untrusted'), permissions: { network: false, secrets: false, env: ['TOKEN'] } })).toBe(true)
    expect(pluginNeedsAttention({ ...installed('trusted'), trusted: true, permissions: { network: false, secrets: true, env: [] } })).toBe(false)
    expect(pluginNeedsAttention({ ...installed('warned'), warnings: ['Read this first'] })).toBe(true)
  })
})
