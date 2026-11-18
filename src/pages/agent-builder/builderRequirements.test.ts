import type { ProviderStatus, WorkflowSecretStatus } from '@/api/types'
import { listBuilderRequirements } from './builderRequirements'

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
