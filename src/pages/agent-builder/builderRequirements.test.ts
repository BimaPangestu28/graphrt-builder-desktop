import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { ProviderStatus, WorkflowSecretStatus } from '@/api/types'
import { pluginDetailPath } from '@/routes'
import { listBuilderRequirements, listPluginSetupRequirements } from './builderRequirements'

const openAiConfigured: ProviderStatus[] = [{ provider: 'openai', configured: true, baseUrl: null }]

function secret(overrides: Partial<WorkflowSecretStatus>): WorkflowSecretStatus {
  return { name: 'MAPS_API_KEY', description: null, isSecret: true, required: true, configured: false, ...overrides }
}

describe('listBuilderRequirements', () => {
  it('lists workflow secrets after the model keys, labelled by description and name', () => {
    const requirements = listBuilderRequirements('new-agent', ['openai'], openAiConfigured, [
      secret({ description: 'Google Places API key' }),
      secret({ name: 'WHATSAPP_TOKEN' }),
    ])

    expect(requirements.map((requirement) => requirement.label)).toEqual([
      'OpenAI · Keychain',
      'Google Places API key · MAPS_API_KEY',
      'WHATSAPP_TOKEN',
    ])
    expect(requirements[1]).toMatchObject({ secretName: 'MAPS_API_KEY', isConnected: false })
  })

  it('treats stored secrets and optional ones (with a default) as connected', () => {
    const requirements = listBuilderRequirements('new-agent', [], null, [
      secret({ configured: true }),
      secret({ name: 'TONE', isSecret: false, required: false }),
    ])

    expect(requirements.every((requirement) => requirement.isConnected)).toBe(true)
  })

  it('shows no secret rows while secrets are loading', () => {
    expect(listBuilderRequirements('new-agent', [], null, null)).toEqual([])
  })
})

function pluginRequirement(overrides: Partial<PluginRequirement> = {}): PluginRequirement {
  return {
    name: 'whatsapp-api',
    description: 'Official WhatsApp Business API',
    usedBySteps: ['Send WhatsApp'],
    permissions: { network: true, secrets: true, env: ['WHATSAPP_ACCESS_TOKEN'] },
    needsBrowser: false,
    warning: null,
    installed: true,
    trusted: true,
    trustNotNeeded: false,
    missingConfig: [],
    browserReady: true,
    needsSession: false,
    sessionLinked: true,
    ready: true,
    ...overrides,
  }
}

describe('listPluginSetupRequirements', () => {
  it('asks to set up a plugin that is not installed', () => {
    expect(listPluginSetupRequirements([pluginRequirement({ installed: false, trusted: false, ready: false })])).toEqual([
      {
        label: 'whatsapp-api plugin',
        pluginName: 'whatsapp-api',
        connectPath: pluginDetailPath('whatsapp-api'),
        isConnected: false,
        pluginState: 'not_installed',
        detail: 'Not installed',
      },
    ])
  })

  it('says what an installed plugin still misses', () => {
    expect(listPluginSetupRequirements([pluginRequirement({ trusted: false, ready: false })])[0]).toMatchObject({ pluginState: 'needs_setup', detail: 'Needs your trust' })
    expect(listPluginSetupRequirements([pluginRequirement({ missingConfig: ['WHATSAPP_ACCESS_TOKEN'], ready: false })])[0]).toMatchObject({ detail: 'Needs 1 setting' })
  })

  it('offers the QR link when an account link is all whatsapp-web still needs', () => {
    const notLinked = pluginRequirement({ name: 'whatsapp-web', needsSession: true, sessionLinked: false, ready: false })
    expect(listPluginSetupRequirements([notLinked])[0]).toMatchObject({ pluginName: 'whatsapp-web', pluginState: 'not_linked', isConnected: false, detail: undefined })
    // Something else still missing comes first.
    const untrusted = { ...notLinked, trusted: false }
    expect(listPluginSetupRequirements([untrusted])[0]).toMatchObject({ pluginState: 'needs_setup', detail: 'Needs your trust' })
    const linked = pluginRequirement({ name: 'whatsapp-web', needsSession: true, sessionLinked: true, ready: true })
    expect(listPluginSetupRequirements([linked])[0]).toMatchObject({ pluginState: 'ready', isConnected: true })
  })

  it('is ready when the backend says so, and empty while loading', () => {
    expect(listPluginSetupRequirements([pluginRequirement()])[0]).toMatchObject({ pluginState: 'ready', isConnected: true, detail: undefined })
    expect(listPluginSetupRequirements(null)).toEqual([])
  })
})
