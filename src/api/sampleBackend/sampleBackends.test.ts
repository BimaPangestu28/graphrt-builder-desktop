import { BackendError } from '../client'
import type { BuildProgress } from '../types'
import { resetSampleAgents, sampleAgentsBackend } from './agents'
import { resetSampleBuilder, sampleBuildDrafts, sampleBuilderBackend, sampleBuildStages, sampleBuildTiming } from './builder'
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
    const reportedStages = progressUpdates
      .map(({ stage, message }) => ({ stage, message }))
      .filter((progress, updateIndex, allUpdates) => progress.stage !== allUpdates[updateIndex - 1]?.stage)
    expect(reportedStages).toEqual(sampleBuildStages)
    expect(progressUpdates[progressUpdates.length - 1].draft).toBeUndefined()
    expect(builtAgent.id).toBe('maps-leads')
  })

  it('streams the explanation, step titles and token count while drafting and repairing', async () => {
    const progressUpdates: BuildProgress[] = []
    await sampleBuilderBackend.buildAgent({ description: 'Find cafes', kind: 'task' }, (progress) => progressUpdates.push(progress))
    const draftingPreviews = progressUpdates.filter((progress) => progress.stage === 'drafting').map((progress) => progress.draft!)
    expect(draftingPreviews.length).toBeGreaterThan(3)
    expect(draftingPreviews[0].explanation.length).toBeLessThan(draftingPreviews[draftingPreviews.length - 1].explanation.length)
    expect(draftingPreviews[0].stepTitles).toEqual([])
    expect(draftingPreviews.map((preview) => preview.outputTokens)).toEqual([...draftingPreviews.map((preview) => preview.outputTokens)].sort((first, second) => first - second))
    expect(draftingPreviews[draftingPreviews.length - 1]).toEqual({
      explanation: sampleBuildDrafts.drafting!.explanation,
      stepTitles: sampleBuildDrafts.drafting!.stepTitles,
      outputTokens: sampleBuildDrafts.drafting!.totalTokens,
    })
    const firstRepairPreview = progressUpdates.find((progress) => progress.stage === 'repairing')!.draft!
    expect(firstRepairPreview.stepTitles).toEqual([])
    expect(progressUpdates.filter((progress) => progress.stage === 'checking' || progress.stage === 'done').every((progress) => !progress.draft)).toBe(true)
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
    expect(revision.explanation).toBe('I updated “Write a short message” and “Send WhatsApp” to do what you asked.')
    const lastDraft = progressUpdates.filter((progress) => progress.draft).pop()!.draft!
    expect(lastDraft.explanation).toBe(revision.explanation)
    expect(lastDraft.stepTitles).toHaveLength(6)
    expect(lastDraft.outputTokens).toBeGreaterThan(0)
    const flowSummary = await sampleBuilderBackend.getFlowSummary('maps-leads')
    expect(flowSummary.steps.find((flowStep) => flowStep.id === 'write_message')?.detail).toBe('Uses the place name · max 1 sentence')
    expect(flowSummary.steps.find((flowStep) => flowStep.id === 'send_whatsapp')?.detail).toBe('From your number on this computer · 45s gap · max 40 per day')
  })

  it('adds a review filter inside the loop', async () => {
    const revision = await sampleBuilderBackend.reviseAgent('maps-leads', 'Skip places with fewer than 80 reviews', () => {})
    expect(revision.changedStepIds).toEqual(['skip_few_reviews'])
    expect(revision.explanation).toBe('I added “Skip places with fewer than 80 reviews” so the agent only goes on with the places you want.')
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
      { provider: 'openai', configured: true, baseUrl: null, localCli: null },
      { provider: 'anthropic', configured: false, baseUrl: null, localCli: null },
      { provider: 'gemini', configured: false, baseUrl: null, localCli: null },
      { provider: 'deepseek', configured: false, baseUrl: null, localCli: null },
      { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434', localCli: null },
      {
        provider: 'claude-code-cli',
        configured: false,
        baseUrl: null,
        localCli: {
          enabled: false,
          installed: true,
          version: '2.1.330 (Claude Code)',
          path: '/Users/you/.local/bin/claude',
          signIn: 'signed_in',
          installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
        },
      },
      {
        provider: 'codex-cli',
        configured: false,
        baseUrl: null,
        localCli: { enabled: false, installed: false, version: null, path: null, signIn: 'unknown', installUrl: 'https://developers.openai.com/codex/cli' },
      },
    ])
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'openai', name: 'gpt-4o-mini' })
    expect(await sampleCredentialsBackend.getWelcomeChoice()).toBeNull()
  })

  it('turns a local CLI on and off, falling back to another default when it was the default', async () => {
    await expectBackendError(sampleCredentialsBackend.setDefaultModel({ provider: 'claude-code-cli', name: 'default' }), 'invalid_input')
    const enabledStatus = await sampleCredentialsBackend.setLocalCliEnabled('claude-code-cli', true)
    expect(enabledStatus).toMatchObject({ provider: 'claude-code-cli', configured: true, localCli: { enabled: true } })
    await sampleCredentialsBackend.setDefaultModel({ provider: 'claude-code-cli', name: 'default' })
    const catalog = await sampleCredentialsBackend.listAvailableModels(false)
    expect(catalog.find((list) => list.provider === 'claude-code-cli')?.models[0]).toEqual({ id: 'default', displayName: 'CLI default' })
    expect(await sampleCredentialsBackend.checkLocalCli('claude-code-cli')).toEqual({ ok: true, message: 'Claude Code answered in 2.1 s' })

    await sampleCredentialsBackend.setLocalCliEnabled('claude-code-cli', false)
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'openai', name: 'gpt-4o-mini' })
    expect((await sampleCredentialsBackend.checkLocalCli('claude-code-cli')).ok).toBe(false)
  })

  it('refuses a local CLI that is not installed and a provider that is not a CLI', async () => {
    await expectBackendError(sampleCredentialsBackend.setLocalCliEnabled('codex-cli', true), 'invalid_input')
    await expectBackendError(sampleCredentialsBackend.setLocalCliEnabled('openai' as 'codex-cli', true), 'invalid_input')
    expect(await sampleCredentialsBackend.checkLocalCli('codex-cli')).toEqual({ ok: false, message: 'Codex is not installed on this computer' })
  })

  it('remembers the Welcome choice until reset', async () => {
    await sampleCredentialsBackend.setWelcomeChoice('skip')
    expect(await sampleCredentialsBackend.getWelcomeChoice()).toBe('skip')
    resetSampleCredentials()
    expect(await sampleCredentialsBackend.getWelcomeChoice()).toBeNull()
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
    expect((await sampleCredentialsBackend.listProviderStatuses()).find((status) => status.provider === 'ollama')?.baseUrl).toBe('http://studio.local:11434')
    expect(await sampleCredentialsBackend.getDefaultModel()).toEqual({ provider: 'ollama', name: 'llama3.2' })
    await expectBackendError(sampleCredentialsBackend.setOllamaBaseUrl('studio.local'), 'invalid_input')
  })

  it('adds, lists without values, replaces and removes a user secret', async () => {
    await sampleCredentialsBackend.addWorkflowSecret({ name: 'MY_SERVER_TOKEN', value: 'token-value', note: ' Home server ' })
    const listed = await sampleCredentialsBackend.listAllWorkflowSecrets()
    const serverToken = listed.find((secret) => secret.name === 'MY_SERVER_TOKEN')
    expect(serverToken).toMatchObject({ configured: true, required: false, agents: [], note: 'Home server' })
    expect(JSON.stringify(listed)).not.toContain('token-value')
    const createdAt = serverToken?.createdAt

    await sampleCredentialsBackend.setWorkflowSecret('MY_SERVER_TOKEN', 'new-value')
    const replaced = (await sampleCredentialsBackend.listAllWorkflowSecrets()).find((secret) => secret.name === 'MY_SERVER_TOKEN')
    expect(replaced).toMatchObject({ note: 'Home server', createdAt })

    await sampleCredentialsBackend.deleteWorkflowSecret('MY_SERVER_TOKEN')
    expect((await sampleCredentialsBackend.listAllWorkflowSecrets()).map((secret) => secret.name)).toEqual(['GOOGLE_PLACES_API_KEY'])
  })

  it('rejects malformed names, empty or huge values and names already saved', async () => {
    for (const badName of ['', 'my_token', '1TOKEN', 'MY-TOKEN', 'A'.repeat(65)]) {
      await expectBackendError(sampleCredentialsBackend.addWorkflowSecret({ name: badName, value: 'v', note: null }), 'invalid_input')
    }
    await expectBackendError(sampleCredentialsBackend.addWorkflowSecret({ name: 'API_TOKEN', value: '  ', note: null }), 'invalid_input')
    await expectBackendError(sampleCredentialsBackend.addWorkflowSecret({ name: 'API_TOKEN', value: 'x'.repeat(16 * 1024 + 1), note: null }), 'invalid_input')
    await expectBackendError(sampleCredentialsBackend.addWorkflowSecret({ name: 'GOOGLE_PLACES_API_KEY', value: 'v', note: null }), 'invalid_input')
  })
})
