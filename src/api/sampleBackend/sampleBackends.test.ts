import { BackendError } from '../client'
import type { BuildProgress } from '../types'
import { resetSampleAgents, sampleAgentsBackend } from './agents'
import { resetSampleBuilder, sampleBuilderBackend, sampleBuildStages, sampleBuildTiming } from './builder'
import { resetSampleCredentials, sampleCredentialsBackend } from './credentials'

async function expectBackendError(promise: Promise<unknown>, code: BackendError['code']) {
  await expect(promise).rejects.toBeInstanceOf(BackendError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('sample agents backend', () => {
  beforeEach(() => resetSampleAgents())

  it('lists the sample agents, most recently updated first', async () => {
    const agents = await sampleAgentsBackend.listAgents()
    expect(agents.map((agent) => agent.id)).toEqual(['maps-leads', 'catering-assistant', 'morning-digest', 'leads-recap', 'sales-team', 'invoice-reminders'])
    expect(agents[0]).toMatchObject({ name: 'Maps leads to WhatsApp', kind: 'task', status: 'active', currentVersion: 7 })
    expect(agents[0].flowYaml).toContain('type: iteration')
  })

  it('rejects unknown agents with not_found', async () => {
    await expectBackendError(sampleAgentsBackend.getAgent('nope'), 'not_found')
    await expectBackendError(sampleAgentsBackend.listAgentVersions('nope'), 'not_found')
  })

  it('renames, changes status and deletes', async () => {
    expect((await sampleAgentsBackend.renameAgent('maps-leads', '  Cafe leads ')).name).toBe('Cafe leads')
    await expectBackendError(sampleAgentsBackend.renameAgent('maps-leads', ' '), 'invalid_input')
    expect((await sampleAgentsBackend.setAgentStatus('maps-leads', 'paused')).status).toBe('paused')
    await sampleAgentsBackend.deleteAgent('maps-leads')
    await expectBackendError(sampleAgentsBackend.getAgent('maps-leads'), 'not_found')
  })

  it('restores an old version as a new one without rewriting history', async () => {
    const restoredAgent = await sampleAgentsBackend.restoreAgentVersion('maps-leads', 5)
    expect(restoredAgent.currentVersion).toBe(8)
    const versions = await sampleAgentsBackend.listAgentVersions('maps-leads')
    expect(versions.map((version) => version.version)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(versions[0].changeSummary).toBe('Restored v5')
    expect(versions[0].flowYaml).toBe(versions[3].flowYaml)
    await expectBackendError(sampleAgentsBackend.restoreAgentVersion('maps-leads', 99), 'not_found')
  })

  it('goes back to the seed data on reset', async () => {
    await sampleAgentsBackend.deleteAgent('maps-leads')
    resetSampleAgents()
    expect((await sampleAgentsBackend.getAgent('maps-leads')).currentVersion).toBe(7)
  })
})

describe('sample builder backend', () => {
  beforeEach(() => {
    resetSampleBuilder()
    resetSampleCredentials()
    sampleBuildTiming.buildStageDelayMs = 0
    sampleBuildTiming.revisionStageDelayMs = 0
  })

  it('summarizes the steps the builder screen shows', async () => {
    const flowSummary = await sampleBuilderBackend.getFlowSummary('maps-leads')
    expect(flowSummary.steps.map((flowStep) => flowStep.title)).toEqual([
      'Ask for keyword, city and offer',
      'Search Google Maps',
      'For each place',
      'Write a short message',
      'Ask me before sending',
      'Send WhatsApp',
    ])
    expect(flowSummary.steps.filter((flowStep) => flowStep.needsApproval).map((flowStep) => flowStep.id)).toEqual(['approve_message'])
    expect(flowSummary.steps.filter((flowStep) => flowStep.depth === 1)).toHaveLength(3)
    expect(flowSummary.inputs.map((input) => input.name)).toEqual(['keyword', 'city', 'offer'])
    expect(flowSummary.modelProviders).toEqual(['openai'])
  })

  it('reports every build stage and resolves to the maps-leads agent', async () => {
    const progressUpdates: BuildProgress[] = []
    const builtAgent = await sampleBuilderBackend.buildAgent({ description: 'Find cafes', kind: 'task' }, (progress) => progressUpdates.push(progress))
    expect(progressUpdates).toEqual(sampleBuildStages)
    expect(builtAgent.id).toBe('maps-leads')
  })

  it('needs a description and a usable model to build', async () => {
    await expectBackendError(sampleBuilderBackend.buildAgent({ description: '  ', kind: null }, () => {}), 'invalid_input')
    await sampleCredentialsBackend.deleteApiKey('openai')
    await expectBackendError(sampleBuilderBackend.buildAgent({ description: 'Find cafes', kind: null }, () => {}), 'missing_credentials')
    await sampleCredentialsBackend.setDefaultModel({ provider: 'ollama', name: 'llama3.2' })
    await expect(sampleBuilderBackend.buildAgent({ description: 'Find cafes', kind: null }, () => {})).resolves.toMatchObject({ id: 'maps-leads' })
  })

  it('saves a revision as a new version and names the changed steps', async () => {
    const progressUpdates: BuildProgress[] = []
    const revision = await sampleBuilderBackend.reviseAgent('maps-leads', 'Make it shorter and wait 45 seconds', (progress) => progressUpdates.push(progress))
    expect(revision.agent.currentVersion).toBe(8)
    expect(revision.changedStepIds).toEqual(['write_message', 'send_whatsapp'])
    expect(revision.summary).toBe('Changed 2 steps: Write a short message, Send WhatsApp')
    expect(progressUpdates[progressUpdates.length - 1]).toEqual({ stage: 'done', message: revision.summary })
    const flowSummary = await sampleBuilderBackend.getFlowSummary('maps-leads')
    expect(flowSummary.steps.find((flowStep) => flowStep.id === 'write_message')?.detail).toBe('Uses the place name · max 1 sentence')
    expect(flowSummary.steps.find((flowStep) => flowStep.id === 'send_whatsapp')?.detail).toBe('From your number on this Mac · 45s gap · max 40 per day')
  })

  it('adds a review filter inside the loop', async () => {
    const revision = await sampleBuilderBackend.reviseAgent('maps-leads', 'Skip places with fewer than 80 reviews', () => {})
    expect(revision.changedStepIds).toEqual(['skip_few_reviews'])
    const flowSummary = await sampleBuilderBackend.getFlowSummary('maps-leads')
    expect(flowSummary.steps[3]).toMatchObject({ title: 'Skip places with fewer than 80 reviews', depth: 1 })
  })

  it('applies any other instruction to the first model step', async () => {
    const revision = await sampleBuilderBackend.reviseAgent('morning-digest', 'Use a friendly tone', () => {})
    expect(revision.changedStepIds).toEqual(['pick_important'])
    await expectBackendError(sampleBuilderBackend.reviseAgent('morning-digest', ' ', () => {}), 'invalid_input')
    await expectBackendError(sampleBuilderBackend.reviseAgent('nope', 'x', () => {}), 'not_found')
  })
})

describe('sample credentials backend', () => {
  beforeEach(() => resetSampleCredentials())

  it('starts with OpenAI and the local Ollama configured', async () => {
    expect(await sampleCredentialsBackend.listProviderStatuses()).toEqual([
      { provider: 'openai', configured: true, baseUrl: null },
      { provider: 'anthropic', configured: false, baseUrl: null },
      { provider: 'gemini', configured: false, baseUrl: null },
      { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' },
    ])
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'openai', name: 'gpt-4o-mini' })
  })

  it('sets and deletes keys, rejecting blank keys and Ollama', async () => {
    await sampleCredentialsBackend.setApiKey('gemini', 'g-key')
    await sampleCredentialsBackend.deleteApiKey('openai')
    const statuses = await sampleCredentialsBackend.listProviderStatuses()
    expect(statuses.find((status) => status.provider === 'gemini')?.configured).toBe(true)
    expect(statuses.find((status) => status.provider === 'openai')?.configured).toBe(false)
    await expectBackendError(sampleCredentialsBackend.setApiKey('anthropic', ' '), 'invalid_input')
    await expectBackendError(sampleCredentialsBackend.setApiKey('ollama', 'x'), 'invalid_input')
  })

  it('stores the Ollama address and default model', async () => {
    await sampleCredentialsBackend.setOllamaBaseUrl('http://studio.local:11434')
    await sampleCredentialsBackend.setDefaultModel({ provider: 'ollama', name: 'llama3.2' })
    expect((await sampleCredentialsBackend.listProviderStatuses())[3].baseUrl).toBe('http://studio.local:11434')
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'ollama', name: 'llama3.2' })
    await expectBackendError(sampleCredentialsBackend.setOllamaBaseUrl('studio.local'), 'invalid_input')
  })
})
