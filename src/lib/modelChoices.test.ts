import type { ProviderModels } from '@/api/modelCatalogTypes'
import type { ProviderStatus } from '@/api/types'
import { buildModelOptionGroups, describeCompactModelChoice, describeModelChoice, describeModelName, recommendedModelFor, recommendedOllamaModel } from './modelChoices'

const statuses: ProviderStatus[] = [
  { provider: 'openai', configured: true, baseUrl: null, localCli: null },
  { provider: 'anthropic', configured: false, baseUrl: null, localCli: null },
  { provider: 'deepseek', configured: true, baseUrl: null, localCli: null },
  { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null },
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

describe('local CLI models in pickers', () => {
  const claudeCodeStatus: ProviderStatus = {
    provider: 'claude-code-cli',
    configured: true,
    baseUrl: null,
    localCli: { enabled: true, installed: true, version: '2.1.330 (Claude Code)', problem: null, path: '/Users/you/.local/bin/claude', signIn: 'signed_in', installUrl: 'https://docs.claude.com/en/docs/claude-code/setup' },
  }
  const codexOffStatus: ProviderStatus = {
    provider: 'codex-cli',
    configured: false,
    baseUrl: null,
    localCli: { enabled: false, installed: true, version: 'codex-cli 0.142.2', problem: null, path: '/usr/local/bin/codex', signIn: 'signed_in', installUrl: 'https://developers.openai.com/codex/cli' },
  }

  it('groups a turned-on CLI under its provider with CLI default first, and leaves out one that is off', () => {
    const catalog: ProviderModels[] = [
      { provider: 'claude-code-cli', models: [{ id: 'sonnet', displayName: 'Sonnet (latest)' }, { id: 'default', displayName: 'CLI default' }], error: null },
    ]
    const groups = buildModelOptionGroups({ provider: 'openai', name: 'gpt-4o-mini' }, [...statuses, claudeCodeStatus, codexOffStatus], catalog)
    const claudeCodeGroup = groups.find((group) => group.provider === 'claude-code-cli')
    expect(claudeCodeGroup?.label).toBe('Claude Code (on this computer)')
    expect(claudeCodeGroup?.choices.map((choice) => choice.name)).toEqual(['default', 'sonnet'])
    expect(groups.map((group) => group.provider)).not.toContain('codex-cli')
  })

  it('labels the CLI default model "CLI default" and recommends it', () => {
    expect(recommendedModelFor('codex-cli')).toEqual({ provider: 'codex-cli', name: 'default' })
    expect(describeModelName({ provider: 'claude-code-cli', name: 'default' })).toBe('CLI default')
    expect(describeModelName({ provider: 'claude-code-cli', name: 'opus' })).toBe('opus')
    expect(describeModelName({ provider: 'openai', name: 'default' })).toBe('default')
    expect(describeCompactModelChoice({ provider: 'claude-code-cli', name: 'default' })).toBe('Claude Code · CLI default')
    expect(describeModelChoice({ provider: 'codex-cli', name: 'default' })).toBe('Codex (on this computer) CLI default')
  })
  it('lists the other CLIs\' models only once they are turned on', () => {
    const geminiStatus = (enabled: boolean): ProviderStatus => ({
      provider: 'gemini-cli',
      configured: enabled,
      baseUrl: null,
      localCli: { enabled, installed: true, version: '0.71.0', problem: null, path: '/opt/homebrew/bin/gemini', signIn: 'unknown', installUrl: 'https://github.com/google-gemini/gemini-cli' },
    })
    const cursorMissing: ProviderStatus = {
      provider: 'cursor-cli',
      configured: false,
      baseUrl: null,
      localCli: { enabled: false, installed: false, version: null, problem: null, path: null, signIn: 'unknown', installUrl: 'https://cursor.com/docs/cli/installation' },
    }
    const catalog: ProviderModels[] = [
      { provider: 'gemini-cli', models: [{ id: 'default', displayName: 'CLI default' }, { id: 'flash', displayName: 'Flash (latest)' }], error: null },
    ]
    const openai = { provider: 'openai' as const, name: 'gpt-4o-mini' }
    const groupsWhenOff = buildModelOptionGroups(openai, [...statuses, geminiStatus(false), cursorMissing], catalog)
    expect(groupsWhenOff.map((group) => group.provider)).not.toContain('gemini-cli')
    const groupsWhenOn = buildModelOptionGroups(openai, [...statuses, geminiStatus(true), cursorMissing], catalog)
    const geminiGroup = groupsWhenOn.find((group) => group.provider === 'gemini-cli')
    expect(geminiGroup?.label).toBe('Gemini CLI (on this computer)')
    expect(geminiGroup?.choices.map((choice) => choice.name)).toEqual(['default', 'flash'])
    expect(groupsWhenOn.map((group) => group.provider)).not.toContain('cursor-cli')
    expect(describeCompactModelChoice({ provider: 'opencode-cli', name: 'anthropic/claude-sonnet-5-5' })).toBe('OpenCode · anthropic/claude-sonnet-5-5')
    expect(recommendedModelFor('qwen-code-cli')).toEqual({ provider: 'qwen-code-cli', name: 'default' })
  })
})

describe('recommendedOllamaModel', () => {
  const ollamaList = (models: ProviderModels['models'], error: string | null = null): ProviderModels[] => [
    { provider: 'openai', models: [{ id: 'gpt-4o', displayName: null, parameterMillions: 999999 }], error: null },
    { provider: 'ollama', models, error },
  ]

  it('picks the largest installed model', () => {
    const catalog = ollamaList([
      { id: 'llama3.2:latest', displayName: null, parameterMillions: 3200 },
      { id: 'qwen2.5:14b', displayName: null, parameterMillions: 14800 },
      { id: 'qwen2.5:7b', displayName: null, parameterMillions: 7600 },
    ])
    expect(recommendedOllamaModel(catalog)).toEqual({ provider: 'ollama', name: 'qwen2.5:14b' })
  })

  it('uses an installed model even when its size is unknown, rather than one that is not installed', () => {
    expect(recommendedOllamaModel(ollamaList([{ id: 'gemma3:latest', displayName: null }]))).toEqual({ provider: 'ollama', name: 'gemma3:latest' })
    const mixed = ollamaList([
      { id: 'custom:latest', displayName: null, parameterMillions: null },
      { id: 'llama3.2:latest', displayName: null, parameterMillions: 3200 },
    ])
    expect(recommendedOllamaModel(mixed)).toEqual({ provider: 'ollama', name: 'llama3.2:latest' })
  })

  it('falls back to llama3.2 when nothing is installed or the list is unknown', () => {
    const fallback = { provider: 'ollama', name: 'llama3.2' }
    expect(recommendedOllamaModel(null)).toEqual(fallback)
    expect(recommendedOllamaModel([])).toEqual(fallback)
    expect(recommendedOllamaModel(ollamaList([]))).toEqual(fallback)
    expect(recommendedOllamaModel(ollamaList([{ id: 'qwen2.5:14b', displayName: null, parameterMillions: 14800 }], 'offline'))).toEqual(fallback)
  })
})
