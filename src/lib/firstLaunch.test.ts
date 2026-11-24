import { BackendError } from '@/api/client'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import type { ProviderStatus } from '@/api/types'
import { hasFinishedWelcome, isModelConnected } from './firstLaunch'

const ollamaStatus: ProviderStatus = { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null }
const claudeCodeOnStatus: ProviderStatus = {
  provider: 'claude-code-cli',
  configured: true,
  baseUrl: null,
  localCli: { enabled: true, installed: true, version: '2.1.330 (Claude Code)', problem: null, path: '/Users/you/.local/bin/claude', signIn: 'signed_in', installUrl: 'https://docs.claude.com/en/docs/claude-code/setup' },
}

describe('isModelConnected', () => {
  it('does not count Ollama alone unless it is the default model', () => {
    expect(isModelConnected([ollamaStatus], { provider: 'openai', name: 'gpt-4o-mini' })).toBe(false)
    expect(isModelConnected([ollamaStatus], null)).toBe(false)
    expect(isModelConnected([ollamaStatus], { provider: 'ollama', name: 'llama3.2' })).toBe(true)
  })

  it('counts a stored key and a turned-on local CLI', () => {
    expect(isModelConnected([{ provider: 'gemini', configured: true, baseUrl: null, localCli: null }], null)).toBe(true)
    expect(isModelConnected([ollamaStatus, claudeCodeOnStatus], null)).toBe(true)
    expect(isModelConnected([{ ...claudeCodeOnStatus, configured: false }], null)).toBe(false)
  })
})

describe('hasFinishedWelcome', () => {
  beforeEach(async () => {
    resetSampleCredentials()
    await sampleCredentialsBackend.deleteApiKey('openai')
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows Welcome on a fresh install with nothing connected', async () => {
    expect(await hasFinishedWelcome()).toBe(false)
  })

  it('skips Welcome once the user chose Skip, so it does not loop back', async () => {
    await sampleCredentialsBackend.setWelcomeChoice('skip')
    expect(await hasFinishedWelcome()).toBe(true)
  })

  it('skips Welcome when a local CLI is turned on, or a key is stored', async () => {
    await sampleCredentialsBackend.setLocalCliEnabled('claude-code-cli', true)
    expect(await hasFinishedWelcome()).toBe(true)
    await sampleCredentialsBackend.setLocalCliEnabled('claude-code-cli', false)
    await sampleCredentialsBackend.setApiKey('deepseek', 'sk-deepseek')
    expect(await hasFinishedWelcome()).toBe(true)
  })

  it('treats a backend error as not ready', async () => {
    vi.spyOn(sampleCredentialsBackend, 'getWelcomeChoice').mockRejectedValue(new BackendError('internal', 'broken'))
    expect(await hasFinishedWelcome()).toBe(false)
  })
})
