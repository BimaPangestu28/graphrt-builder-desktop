import type { InstalledPlugin } from '@/api/pluginTypes'
import type { FlowStep, ProviderStatus, WorkflowSecretStatus } from '@/api/types'
import { connectionsPluginsPath } from '@/routes'
import { listBuilderRequirements, listPluginRequirements, listStepPluginNames } from './builderRequirements'

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

function flowStep(id: string, nodeType: string): FlowStep {
  return { id, nodeType, title: id, detail: '', needsApproval: false, depth: 0 }
}

function installedWhatsAppApi(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    name: 'whatsapp-api',
    version: '0.3.0',
    description: 'Official WhatsApp Business API',
    permissions: { network: true, secrets: true, env: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] },
    trusted: true,
    needsBrowser: false,
    nodes: [],
    tools: [],
    config: [
      { name: 'WHATSAPP_ACCESS_TOKEN', configured: true },
      { name: 'WHATSAPP_PHONE_NUMBER_ID', configured: true },
    ],
    loadError: null,
    warnings: [],
    readmeUrl: null,
    ...overrides,
  }
}

const whatsAppFlowSteps = [flowStep('write', 'llm'), flowStep('send', 'whatsapp-api.send_text'), flowStep('send_again', 'whatsapp-api.send_template')]

describe('listPluginRequirements', () => {
  it('reads plugin names from dotted node types only, once each', () => {
    expect(listStepPluginNames([...whatsAppFlowSteps, flowStep('maps', 'google-maps-scraper.search'), flowStep('if', 'if-else')])).toEqual([
      'whatsapp-api',
      'google-maps-scraper',
    ])
  })

  it('asks to install a plugin a whatsapp-api.send_text step needs', () => {
    expect(listPluginRequirements(whatsAppFlowSteps, [])).toEqual([
      {
        label: 'whatsapp-api plugin',
        pluginName: 'whatsapp-api',
        connectPath: connectionsPluginsPath,
        isConnected: false,
        pluginState: 'not_installed',
        detail: 'Not installed',
      },
    ])
  })

  it('links to Connections → Plugins while untrusted, and hints at unset settings', () => {
    expect(listPluginRequirements(whatsAppFlowSteps, [installedWhatsAppApi({ trusted: false })])[0]).toMatchObject({
      pluginState: 'needs_setup',
      detail: 'Installed · not trusted yet',
      connectPath: connectionsPluginsPath,
    })
    const missingToken = installedWhatsAppApi({ config: [{ name: 'WHATSAPP_ACCESS_TOKEN', configured: false }, { name: 'WHATSAPP_PHONE_NUMBER_ID', configured: true }] })
    expect(listPluginRequirements(whatsAppFlowSteps, [missingToken])[0]).toMatchObject({
      pluginState: 'ready',
      detail: 'Ready · not set (optional?): WHATSAPP_ACCESS_TOKEN',
    })
  })

  it('is ready once trusted with every setting, and empty while loading', () => {
    expect(listPluginRequirements(whatsAppFlowSteps, [installedWhatsAppApi()])[0]).toMatchObject({ pluginState: 'ready', isConnected: true })
    expect(listPluginRequirements(whatsAppFlowSteps, null)).toEqual([])
  })
})
