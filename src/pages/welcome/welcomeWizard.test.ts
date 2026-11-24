import type { LocalCliProvider, LocalCliSignIn, ProviderStatus } from '@/api/types'
import {
  brokenTools,
  canLeaveStep,
  choiceGridColumns,
  checkApiKey,
  installedTools,
  nextStepId,
  previousStepId,
  recommendApproach,
  recommendedTool,
  welcomeChoiceFor,
  wizardStepsFor,
  type WizardAnswers,
} from './welcomeWizard'

function cliStatus(provider: LocalCliProvider, installed: boolean, signIn: LocalCliSignIn = 'unknown', problem: string | null = null): ProviderStatus {
  return {
    provider,
    configured: false,
    baseUrl: null,
    localCli: { enabled: false, installed, version: installed ? '1.0.0' : null, problem, path: null, signIn, installUrl: 'https://example.com' },
  }
}

const nothingInstalled = [cliStatus('claude-code-cli', false), cliStatus('codex-cli', false), cliStatus('gemini-cli', false)]

const validOpenAiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz'

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return { approach: null, tool: null, apiKeyProvider: 'openai', apiKey: '', ...overrides }
}

describe('wizardStepsFor', () => {
  it('has five steps, and skips Connect for "Decide later"', () => {
    expect(wizardStepsFor(null)).toEqual(['welcome', 'approach', 'setup', 'background', 'done'])
    expect(wizardStepsFor('company-key')).toEqual(['welcome', 'approach', 'setup', 'background', 'done'])
    expect(wizardStepsFor('later')).toEqual(['welcome', 'approach', 'background', 'done'])
  })

  it('moves forward and back within the steps', () => {
    const steps = wizardStepsFor('later')
    expect(nextStepId(steps, 'approach')).toBe('background')
    expect(previousStepId(steps, 'background')).toBe('approach')
    expect(nextStepId(steps, 'done')).toBeNull()
    expect(previousStepId(steps, 'welcome')).toBeNull()
  })
})

describe('installedTools and recommendedTool', () => {
  it('lists found tools with signed-in ones first, Claude Code and Codex before the others', () => {
    const statuses = [cliStatus('claude-code-cli', true), cliStatus('codex-cli', true, 'signed_in'), cliStatus('gemini-cli', true), cliStatus('cursor-cli', false)]
    expect(installedTools(statuses)).toEqual(['codex-cli', 'claude-code-cli', 'gemini-cli'])
    expect(recommendedTool(statuses)).toBe('codex-cli')
  })

  it('has no tool while detection runs or when nothing is installed', () => {
    expect(recommendedTool(null)).toBeNull()
    expect(recommendedTool(nothingInstalled)).toBeNull()
  })
})

describe('recommendApproach', () => {
  it('waits for detection', () => {
    expect(recommendApproach({ statuses: null, isOllamaRunning: true })).toBeNull()
    expect(recommendApproach({ statuses: nothingInstalled, isOllamaRunning: null })).toBeNull()
  })

  it('prefers an AI account already signed in, even before Ollama answers', () => {
    expect(recommendApproach({ statuses: [cliStatus('claude-code-cli', true, 'signed_in')], isOllamaRunning: null })).toBe('existing-account')
  })

  it('prefers a running Ollama over a tool whose sign-in is not confirmed', () => {
    expect(recommendApproach({ statuses: [cliStatus('codex-cli', true)], isOllamaRunning: true })).toBe('private-model')
    expect(recommendApproach({ statuses: [cliStatus('codex-cli', true)], isOllamaRunning: false })).toBe('existing-account')
  })

  it('falls back to a company key when nothing is found', () => {
    expect(recommendApproach({ statuses: nothingInstalled, isOllamaRunning: false })).toBe('company-key')
  })
})

describe('checkApiKey', () => {
  it('blocks an empty, spaced or too-short key', () => {
    expect(checkApiKey('openai', '   ')).toEqual({ status: 'empty' })
    expect(checkApiKey('openai', 'sk-abc def ghi jkl mno pqr').status).toBe('invalid')
    expect(checkApiKey('openai', 'sk-test').status).toBe('invalid')
  })

  it('accepts a key that matches its provider, ignoring surrounding spaces', () => {
    expect(checkApiKey('openai', `  ${validOpenAiKey}  `)).toEqual({ status: 'ok' })
    expect(checkApiKey('anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toEqual({ status: 'ok' })
    expect(checkApiKey('gemini', 'AIzaSyAbcdefghijklmnopqrstuvwxyz')).toEqual({ status: 'ok' })
  })

  it('warns and suggests the right provider when a key looks like another one', () => {
    expect(checkApiKey('openai', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toMatchObject({ status: 'warning', suggestedProvider: 'anthropic' })
    expect(checkApiKey('deepseek', 'AIzaSyAbcdefghijklmnopqrstuvwxyz')).toMatchObject({ status: 'warning', suggestedProvider: 'gemini' })
    expect(checkApiKey('gemini', validOpenAiKey)).toMatchObject({ status: 'warning', suggestedProvider: null })
  })
})

describe('canLeaveStep', () => {
  const statuses = [cliStatus('claude-code-cli', true, 'signed_in'), cliStatus('codex-cli', false)]

  it('needs an approach, and a found tool for "an account I already have"', () => {
    expect(canLeaveStep('approach', answers(), statuses)).toBe(false)
    expect(canLeaveStep('approach', answers({ approach: 'later' }), statuses)).toBe(true)
    expect(canLeaveStep('approach', answers({ approach: 'existing-account' }), statuses)).toBe(true)
    expect(canLeaveStep('approach', answers({ approach: 'existing-account' }), nothingInstalled)).toBe(false)
  })

  it('needs an installed tool or a usable key on Connect; Ollama can be finished later', () => {
    expect(canLeaveStep('setup', answers({ approach: 'existing-account', tool: 'claude-code-cli' }), statuses)).toBe(true)
    expect(canLeaveStep('setup', answers({ approach: 'existing-account', tool: 'codex-cli' }), statuses)).toBe(false)
    expect(canLeaveStep('setup', answers({ approach: 'company-key', apiKey: 'sk-test' }), statuses)).toBe(false)
    expect(canLeaveStep('setup', answers({ approach: 'company-key', apiKey: validOpenAiKey }), statuses)).toBe(true)
    expect(canLeaveStep('setup', answers({ approach: 'private-model' }), statuses)).toBe(true)
  })

  it('never blocks Welcome, Background or Done', () => {
    expect(canLeaveStep('welcome', answers(), null)).toBe(true)
    expect(canLeaveStep('background', answers(), null)).toBe(true)
    expect(canLeaveStep('done', answers({ approach: 'later' }), null)).toBe(true)
  })
})

describe('welcomeChoiceFor', () => {
  it('maps each approach to the choice the old Welcome screen saved', () => {
    expect(welcomeChoiceFor(answers({ approach: 'existing-account', tool: 'gemini-cli' }))).toBe('gemini-cli')
    expect(welcomeChoiceFor(answers({ approach: 'company-key' }))).toBe('api-key')
    expect(welcomeChoiceFor(answers({ approach: 'private-model' }))).toBe('ollama')
    expect(welcomeChoiceFor(answers({ approach: 'later' }))).toBe('skip')
    expect(welcomeChoiceFor(answers())).toBeNull()
  })
})

describe('choiceGridColumns', () => {
  it('uses three columns only when the cards fill whole rows, else two (one for a single card)', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(choiceGridColumns)).toEqual([1, 2, 3, 2, 2, 3, 2])
  })
})

describe('tools that are found but do not start', () => {
  const brokenCodex = cliStatus('codex-cli', true, 'signed_in', 'Found, but it does not start.')

  it('are not usable, recommended or enough to leave a step', () => {
    const statuses = [cliStatus('claude-code-cli', false), brokenCodex]
    expect(installedTools(statuses)).toEqual([])
    expect(brokenTools(statuses)).toEqual(['codex-cli'])
    expect(recommendApproach({ statuses, isOllamaRunning: false })).toBe('company-key')
    expect(canLeaveStep('approach', answers({ approach: 'existing-account' }), statuses)).toBe(false)
    expect(canLeaveStep('setup', answers({ approach: 'existing-account', tool: 'codex-cli' }), statuses)).toBe(false)
  })
})
