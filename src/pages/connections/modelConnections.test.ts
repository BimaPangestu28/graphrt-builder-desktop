import type { ProviderStatus } from '@/api/types'
import { buildModelConnections, countConnectedModels } from './modelConnections'

const statuses: ProviderStatus[] = [
  { provider: 'openai', configured: true, baseUrl: null, localCli: null },
  { provider: 'anthropic', configured: false, baseUrl: null, localCli: null },
  { provider: 'gemini', configured: false, baseUrl: null, localCli: null },
  { provider: 'deepseek', configured: true, baseUrl: null, localCli: null },
  { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null },
]

describe('buildModelConnections', () => {
  it('shows a DeepSeek card that uses an API key', () => {
    const cards = buildModelConnections(statuses, { provider: 'openai', name: 'gpt-4o-mini' })
    const deepseekCard = cards.find((card) => card.provider === 'deepseek')
    expect(deepseekCard).toMatchObject({ name: 'DeepSeek', usesApiKey: true, state: 'connected' })
  })

  it('marks DeepSeek as the default when it is the default model provider', () => {
    const cards = buildModelConnections(statuses, { provider: 'deepseek', name: 'deepseek-chat' })
    expect(cards.find((card) => card.provider === 'deepseek')?.state).toBe('default')
    expect(cards.find((card) => card.provider === 'openai')?.state).toBe('connected')
  })

  it('offers DeepSeek as available when no key is stored', () => {
    const withoutKey = statuses.map((status) => (status.provider === 'deepseek' ? { ...status, configured: false } : status))
    const cards = buildModelConnections(withoutKey, { provider: 'openai', name: 'gpt-4o-mini' })
    expect(cards.find((card) => card.provider === 'deepseek')?.state).toBe('available')
  })
})

describe('buildModelConnections in the desktop app', () => {
  const desktopStatuses: ProviderStatus[] = [
    { provider: 'openai', configured: true, baseUrl: null, localCli: null },
    { provider: 'deepseek', configured: true, baseUrl: null, localCli: null },
    { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null },
  ]

  it('describes connected providers from real data, without design sample text', () => {
    const cards = buildModelConnections(desktopStatuses, { provider: 'deepseek', name: 'deepseek-chat' }, { useDesignText: false })
    expect(cards.find((card) => card.provider === 'deepseek')?.connectedDescription).toBe('Key in Keychain · default model deepseek-chat')
    expect(cards.find((card) => card.provider === 'openai')?.connectedDescription).toBe('Key in Keychain')
    expect(cards.find((card) => card.provider === 'ollama')?.connectedDescription).toBe('http://localhost:11434')
    expect(cards.map((card) => card.connectedDescription).join(' ')).not.toMatch(/\$|qwen|this month/)
  })
})

describe('countConnectedModels', () => {
  const onlyOllama: ProviderStatus[] = [
    { provider: 'openai', configured: false, baseUrl: null, localCli: null },
    { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null },
  ]

  it('does not count Ollama while no model is connected, though the backend always reports it as set up', () => {
    expect(countConnectedModels(buildModelConnections(onlyOllama, null))).toBe(0)
  })

  it('counts Ollama once it is the default model', () => {
    expect(countConnectedModels(buildModelConnections(onlyOllama, { provider: 'ollama', name: 'llama3.2' }))).toBe(1)
  })

  it('counts every provider with a key, and leaves Ollama out while another one is the default', () => {
    expect(countConnectedModels(buildModelConnections(statuses, { provider: 'openai', name: 'gpt-4o-mini' }))).toBe(2)
  })
})
