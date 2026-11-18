import { BackendError } from '../../client'
import type { ChainStep } from '../../chainTypes'
import { resetSampleAgents, sampleAgentsBackend } from '../agents'
import { sampleBuilderBackend } from '../builder'
import { resetSampleChains, sampleChainsBackend } from '../chains'

async function expectBackendError(promise: Promise<unknown>, code: BackendError['code']) {
  await expect(promise).rejects.toBeInstanceOf(BackendError)
  await expect(promise).rejects.toMatchObject({ code })
}

function step(agentId: string, overrides: Partial<ChainStep> = {}): ChainStep {
  return { agentId, inputs: [], runCondition: 'on_success', onFailure: 'stop', ...overrides }
}

describe('sample chains backend', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleChains()
  })

  it('seeds the chain of screen 11 from its mock data', async () => {
    const [chain] = await sampleChainsBackend.listChains()
    expect(chain).toMatchObject({ id: 'leads-recap', name: 'Leads to sales recap', status: 'paused' })
    expect(chain.steps.map((chainStep) => chainStep.agentId)).toEqual(['maps-leads', 'lead-tracker', 'sales-recap'])
    expect(chain.steps[1]).toEqual({
      agentId: 'lead-tracker',
      inputs: [
        { input: 'leads', source: { kind: 'output', outputKey: 'places' } },
        { input: 'source', source: { kind: 'constant', value: 'Google Maps outreach' } },
      ],
      runCondition: 'on_success',
      onFailure: 'stop',
    })
    expect(chain.steps[2]).toMatchObject({ runCondition: 'always', onFailure: 'continue' })
  })

  it('creates, updates, activates, tests and deletes chains', async () => {
    const created = await sampleChainsBackend.createChain({ name: ' Recap ', steps: [step('lead-tracker')] })
    expect(created).toMatchObject({ name: 'Recap', status: 'paused' })
    const updated = await sampleChainsBackend.updateChain(created.id, { name: 'Recap', steps: [step('lead-tracker'), step('sales-recap')] })
    expect(updated.steps).toHaveLength(2)
    expect((await sampleChainsBackend.setChainStatus(created.id, 'active')).status).toBe('active')
    const run = await sampleChainsBackend.testChain(created.id)
    expect(run).toMatchObject({ agentId: 'lead-tracker', trigger: 'test', status: 'running' })
    await sampleChainsBackend.deleteChain(created.id)
    await expectBackendError(sampleChainsBackend.getChain(created.id), 'not_found')
  })

  it('rejects invalid chains like the backend', async () => {
    await expectBackendError(sampleChainsBackend.createChain({ name: ' ', steps: [] }), 'invalid_input')
    await expectBackendError(sampleChainsBackend.createChain({ name: 'x', steps: [step('lead-tracker'), step('lead-tracker')] }), 'invalid_input')
    const outputOnFirst = step('lead-tracker', { inputs: [{ input: 'a', source: { kind: 'output', outputKey: 'b' } }] })
    await expectBackendError(sampleChainsBackend.createChain({ name: 'x', steps: [outputOnFirst] }), 'invalid_input')
    await expectBackendError(sampleChainsBackend.createChain({ name: 'x', steps: [step('ghost')] }), 'not_found')
    const empty = await sampleChainsBackend.createChain({ name: 'Empty', steps: [] })
    await expectBackendError(sampleChainsBackend.testChain(empty.id), 'invalid_input')
  })

  it('lists agents as steps with inputs, outputs and usage', async () => {
    const catalog = await sampleChainsBackend.listAgentSteps()
    const qualifier = catalog.find((agent) => agent.agentId === 'lead-qualifier')
    expect(qualifier).toMatchObject({ outputs: ['score', 'reason'], usedByCount: 2, currentVersion: 3, usableAsStep: true })
    expect(qualifier?.inputs.map((input) => input.name)).toEqual(['place'])
    expect(catalog.find((agent) => agent.agentId === 'maps-leads')?.usableAsStep).toBe(false)
  })

  it('adds an agent step as a new version of the target agent', async () => {
    const progress: string[] = []
    const revision = await sampleChainsBackend.addAgentStep(
      { targetAgentId: 'maps-leads', stepAgentId: 'lead-qualifier', placement: 'after the step "Search Google Maps"' },
      (update) => progress.push(update.stage),
    )
    expect(revision.changedStepIds).toEqual(['run_lead_qualifier'])
    expect(revision.agent.currentVersion).toBe(8)
    expect(progress.length).toBeGreaterThan(0)
    const summary = await sampleBuilderBackend.getFlowSummary('maps-leads')
    const titles = summary.steps.map((flowStep) => flowStep.title)
    expect(titles.indexOf('Run Lead qualifier')).toBe(titles.indexOf('Search Google Maps') + 1)
    expect(summary.steps.find((flowStep) => flowStep.id === 'run_lead_qualifier')).toMatchObject({ nodeType: 'tool', detail: 'agents/lead-qualifier' })
    await expectBackendError(sampleChainsBackend.addAgentStep({ targetAgentId: 'maps-leads', stepAgentId: 'maps-leads', placement: null }, () => {}), 'invalid_input')
    await expectBackendError(sampleChainsBackend.addAgentStep({ targetAgentId: 'lead-tracker', stepAgentId: 'maps-leads', placement: null }, () => {}), 'invalid_input')
  })

  it('reads the team from its members and the team agent status, and adds members', async () => {
    const team = await sampleChainsBackend.getTeam('sales-team')
    expect(team).toMatchObject({ name: 'Catering sales team', status: 'active', coordinatorStepId: 'coordinator' })
    expect(team.members.map((member) => member.name)).toEqual(['Researcher', 'Qualifier', 'Outreach', 'Reporter'])
    expect(team.members.map((member) => member.latestRun?.status ?? null)).toEqual(['succeeded', 'running', 'paused', null])

    await sampleAgentsBackend.setAgentStatus('sales-team', 'paused')
    expect((await sampleChainsBackend.getTeam('sales-team')).status).toBe('paused')

    await sampleChainsBackend.addTeamMember('sales-team', 'lead-qualifier', () => {})
    expect((await sampleChainsBackend.getTeam('sales-team')).members.map((member) => member.agentId)).toContain('lead-qualifier')
    await expectBackendError(sampleChainsBackend.addTeamMember('sales-team', 'lead-qualifier', () => {}), 'invalid_input')
  })

  it('goes back to the seed on reset', async () => {
    await sampleChainsBackend.deleteChain('leads-recap')
    resetSampleChains()
    expect(await sampleChainsBackend.listChains()).toHaveLength(1)
  })
})
