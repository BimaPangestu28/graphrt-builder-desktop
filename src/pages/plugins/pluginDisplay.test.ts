import type { InstalledPlugin, PluginCatalog } from '@/api/pluginTypes'
import { describeBrowserRuntimeEvent } from '@/hooks/useBrowserRuntime'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import {
  buildPluginListItems,
  describeCommunityInstallNote,
  describeInstallProgress,
  describePluginSource,
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
      displayName: humanizePluginName(name),
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
      source: 'official',
      publisher: null,
      repositoryUrl: null,
      installedVersion: null,
      updateAvailable: false,
      updateNeedsApproval: false,
    })),
    generatedAt: null,
    fromCache: false, fetchedAt: null,
  }
}

function installed(name: string): InstalledPlugin {
  return {
    name,
    displayName: humanizePluginName(name),
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
    source: 'official',
    publisher: null,
    repositoryUrl: null,
    localPath: null,
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

  it('names each card by its display name, humanizing the name when there is none', () => {
    const catalog = catalogWith('whatsapp-api', 'currency-rates')
    catalog.plugins[0].displayName = 'WhatsApp Cloud API'
    catalog.plugins[1].displayName = ''
    const items = buildPluginListItems(catalog, [{ ...installed('local-sftp'), displayName: '' }])
    expect(items.map((item) => [item.name, item.displayName])).toEqual([
      ['local-sftp', 'Local SFTP'],
      ['whatsapp-api', 'WhatsApp Cloud API'],
      ['currency-rates', 'Currency Rates'],
    ])
  })

  it('searches both the display name and the technical name', () => {
    const catalog = catalogWith('whatsapp-api', 'currency-rates')
    catalog.plugins[0].displayName = 'WhatsApp Cloud API'
    const items = buildPluginListItems(catalog, [])
    expect(filterPluginListItems(items, 'cloud api').map((item) => item.name)).toEqual(['whatsapp-api'])
    expect(filterPluginListItems(items, 'WHATSAPP-API').map((item) => item.name)).toEqual(['whatsapp-api'])
    expect(filterPluginListItems(items, 'currency rates').map((item) => item.name)).toEqual(['currency-rates'])
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

describe('plugin sources', () => {
  it('badges community and local plugins, never official ones', () => {
    expect(describePluginSource('official')).toBeNull()
    expect(describePluginSource('community')).toEqual({ label: 'Community', tone: 'brand' })
    expect(describePluginSource('local')).toEqual({ label: 'Local · not reviewed', tone: 'amber' })
  })

  it('names the publisher of a community plugin in the install note', () => {
    expect(describeCommunityInstallNote({ source: 'community', publisher: 'Acme Inc.' })).toBe('Reviewed by the graphrt maintainers, but maintained by Acme Inc.')
    expect(describeCommunityInstallNote({ source: 'community', publisher: null })).toBe('Reviewed by the graphrt maintainers, but maintained by a third party.')
    expect(describeCommunityInstallNote({ source: 'official', publisher: 'graphrt' })).toBeNull()
  })

  it('carries the catalog labels and lets a local plugin replace the catalog entry of its name', () => {
    const catalog = catalogWith('alpha', 'beta')
    catalog.plugins[0] = { ...catalog.plugins[0], source: 'community', publisher: 'Acme', repositoryUrl: 'https://example.test/alpha', updateAvailable: true }
    catalog.plugins[1] = { ...catalog.plugins[1], updateAvailable: true }
    const localBeta = { ...installed('beta'), source: 'local' as const, localPath: '/code/beta' }

    const items = buildPluginListItems(catalog, [localBeta])

    expect(items.map((item) => [item.name, item.source, item.updateAvailable])).toEqual([
      ['beta', 'local', false],
      ['alpha', 'community', true],
    ])
    expect(items[0].localPath).toBe('/code/beta')
    expect(items[1]).toMatchObject({ publisher: 'Acme', repositoryUrl: 'https://example.test/alpha' })
  })
})
