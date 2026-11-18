import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { ProviderStatus } from '@/api/types'
import { buildModelOptionGroups } from './modelChoices'

const statuses: ProviderStatus[] = [
  { provider: 'openai', configured: true, baseUrl: null },
  { provider: 'anthropic', configured: false, baseUrl: null },
  { provider: 'deepseek', configured: true, baseUrl: null },
  { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' },
]

describe('buildModelOptionGroups', () => {
  it('falls back to recommended models while the lists load, default provider first', () => {
    const groups = buildModelOptionGroups({ provider: 'deepseek', name: 'deepseek-chat' }, statuses, null)
    expect(groups.map((group) => group.provider)).toEqual(['deepseek', 'openai'])
    expect(groups[1].choices).toEqual([{ provider: 'openai', name: 'gpt-4o-mini' }])
    expect(groups.every((group) => group.note === null)).toBe(true)
  })

  it('lists every reported model and keeps the default selectable', () => {
    const catalog: ProviderModels[] = [
      { provider: 'openai', models: [{ id: 'gpt-4.1', displayName: null }, { id: 'gpt-4o', displayName: null }], error: null },
      { provider: 'deepseek', models: [{ id: 'deepseek-reasoner', displayName: null }], error: null },
    ]
    const groups = buildModelOptionGroups({ provider: 'deepseek', name: 'deepseek-chat' }, statuses, catalog)
    expect(groups[0].choices.map((choice) => choice.name)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(groups[1].choices.map((choice) => choice.name)).toEqual(['gpt-4.1', 'gpt-4o'])
  })

  it('explains a provider whose list failed and offers its recommended model', () => {
    const catalog: ProviderModels[] = [{ provider: 'openai', models: [], error: 'the key was rejected by the provider' }]
    const groups = buildModelOptionGroups({ provider: 'openai', name: 'gpt-4o-mini' }, statuses, catalog)
    expect(groups[0]).toMatchObject({ choices: [{ provider: 'openai', name: 'gpt-4o-mini' }], note: 'showing the recommended model: the key was rejected by the provider' })
  })

  it('shows Ollama only when it answered or is the default', () => {
    const withOllama: ProviderModels[] = [{ provider: 'ollama', models: [{ id: 'qwen2.5:14b', displayName: null }], error: null }]
    expect(buildModelOptionGroups({ provider: 'openai', name: 'gpt-4o-mini' }, statuses, []).map((group) => group.provider)).not.toContain('ollama')
    expect(buildModelOptionGroups({ provider: 'openai', name: 'gpt-4o-mini' }, statuses, withOllama).map((group) => group.provider)).toContain('ollama')
  })
})
