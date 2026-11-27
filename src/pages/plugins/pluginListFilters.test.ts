import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { InstalledPlugin, PluginCatalog } from '@/api/pluginTypes'
import type { Agent } from '@/api/types'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import { categorizePlugin } from './pluginCategories'
import { buildPluginListItems, countPluginsByTab, describeMaturity, describePluginStatus, pluginMonogram } from './pluginDisplay'
import { applyTabAndSearch, countPluginCategories, readPluginListFilters, writePluginListFilters } from './pluginListFilters'
import { findPluginUsers } from './usePluginUsers'

const noPermissions = { network: false, secrets: false, env: [] }

function catalogEntry(name: string, overrides: Partial<PluginCatalog['plugins'][number]> = {}): PluginCatalog['plugins'][number] {
  return {
    name,
    displayName: humanizePluginName(name),
    version: '1.0.0',
    description: '',
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
    ...overrides,
  }
}

function installedPlugin(name: string, overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    name,
    displayName: humanizePluginName(name),
    version: '1.0.0',
    description: '',
    permissions: noPermissions,
    trusted: true,
    needsBrowser: false,
    needsNodeRuntime: true,
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
    ...overrides,
  }
}

function buildSampleItems() {
  const catalog: PluginCatalog = {
    plugins: [
      catalogEntry('telegram-bot', { description: 'Send Telegram messages' }),
      catalogEntry('stripe', { installedVersion: '0.9.0', updateAvailable: true }),
      catalogEntry('postgres', { installedVersion: '1.0.0' }),
      catalogEntry('email-tool', { installedVersion: '1.0.0', permissions: { network: true, secrets: true, env: [] } }),
    ],
    generatedAt: null,
    fromCache: false, fetchedAt: null, fetchError: null,
  }
  return buildPluginListItems(catalog, [
    installedPlugin('stripe', { version: '0.9.0' }),
    installedPlugin('postgres'),
    installedPlugin('email-tool', { trusted: false, permissions: { network: true, secrets: true, env: [] } }),
  ])
}

describe('categorizePlugin', () => {
  it('places plugins by name first, then by description', () => {
    expect(categorizePlugin('whatsapp-web', '')).toBe('messaging')
    expect(categorizePlugin('tiktok-shop-api', '')).toBe('commerce')
    expect(categorizePlugin('google-sheets', '')).toBe('data')
    expect(categorizePlugin('openai', '')).toBe('ai')
    expect(categorizePlugin('google-maps-scraper', '')).toBe('web')
    expect(categorizePlugin('acme', 'Uploads a PDF file')).toBe('files')
    expect(categorizePlugin('acme', 'Does something')).toBe('other')
  })

  it('files a document plugin under files although its description mentions invoices', () => {
    expect(categorizePlugin('document-templates', 'Invoices and other documents from templates, fully local')).toBe('files')
    // A plugin that only says "invoice" in its description is still a payments plugin.
    expect(categorizePlugin('acme-billing', 'Sends an invoice and takes the payment')).toBe('commerce')
  })
})

describe('plugin card text', () => {
  it('gives one status per plugin, most important first', () => {
    const [stripe, postgres, emailTool, telegram] = ['stripe', 'postgres', 'email-tool', 'telegram-bot'].map((name) => buildSampleItems().find((item) => item.name === name)!)
    expect(describePluginStatus(stripe)).toEqual({ label: 'Update available', tone: 'brand' })
    expect(describePluginStatus(postgres)).toEqual({ label: 'Installed v1.0.0', tone: 'ok' })
    expect(describePluginStatus(emailTool)).toEqual({ label: 'Needs setup', tone: 'amber' })
    expect(describePluginStatus(telegram)).toEqual({ label: 'Not installed', tone: 'neutral' })
    expect(describePluginStatus({ ...postgres, installed: { ...postgres.installed!, loadError: 'bad' } })).toEqual({ label: 'Failed to load', tone: 'danger' })
  })

  it('labels only maturity worth pointing out, and builds monograms', () => {
    expect(describeMaturity('beta')).toBe('Beta')
    expect(describeMaturity('stable')).toBeNull()
    expect(describeMaturity(null)).toBeNull()
    expect(pluginMonogram('google-maps-scraper')).toBe('GM')
    expect(pluginMonogram('stripe')).toBe('ST')
  })
})

describe('plugin list filters', () => {
  it('counts each tab', () => {
    expect(countPluginsByTab(buildSampleItems())).toEqual({ all: 4, installed: 3, updates: 1, attention: 1 })
  })

  it('round-trips through the URL and ignores unknown values', () => {
    const filters = { tab: 'updates' as const, searchText: 'pay', category: 'commerce' as const }
    expect(readPluginListFilters(writePluginListFilters(filters))).toEqual(filters)
    expect(writePluginListFilters({ tab: 'all', searchText: '', category: null }).toString()).toBe('')
    expect(readPluginListFilters(new URLSearchParams('tab=nope&category=nope'))).toEqual({ tab: 'all', searchText: '', category: null })
  })

  it('applies tab and search, and counts categories of the result', () => {
    const items = buildSampleItems()
    expect(applyTabAndSearch(items, { tab: 'installed', searchText: 'post', category: null }).map((item) => item.name)).toEqual(['postgres'])
    expect(countPluginCategories(items)).toEqual([
      { category: 'messaging', count: 2 },
      { category: 'data', count: 1 },
      { category: 'commerce', count: 1 },
    ])
  })
})

describe('findPluginUsers', () => {
  it('keeps the agents whose requirements name the plugin', () => {
    const agents = [
      { id: 'a1', name: 'Leads' },
      { id: 'a2', name: 'Recap' },
      { id: 'a3', name: 'Unread' },
    ] as Agent[]
    const requirement = { name: 'stripe', usedBySteps: ['Charge'], ready: false } as PluginRequirement
    const requirementsByAgentId = new Map<string, PluginRequirement[]>([
      ['a1', [requirement]],
      ['a2', [{ ...requirement, name: 'postgres' }]],
    ])
    expect(findPluginUsers(agents, requirementsByAgentId, 'stripe')).toEqual([{ agentId: 'a1', agentName: 'Leads', usedBySteps: ['Charge'], isReady: false }])
  })
})
