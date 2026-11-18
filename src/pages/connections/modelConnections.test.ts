import type { ProviderStatus } from '@/api/types'
import { buildModelConnections } from './modelConnections'

const statuses: ProviderStatus[] = [
  { provider: 'openai', configured: true, baseUrl: null },
  { provider: 'anthropic', configured: false, baseUrl: null },
  { provider: 'gemini', configured: false, baseUrl: null },
  { provider: 'deepseek', configured: true, baseUrl: null },
  { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' },
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
