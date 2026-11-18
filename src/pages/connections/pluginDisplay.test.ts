import type { InstalledPlugin, PluginCatalog } from '@/api/pluginTypes'
import { describeBrowserRuntimeEvent } from '@/hooks/useBrowserRuntime'
import { buildPluginListItems, describeInstallProgress, describePluginPermissions } from './pluginDisplay'

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
      sizeBytes: 1,
      installedVersion: null,
      updateAvailable: false,
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
  }
}

describe('buildPluginListItems', () => {
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
