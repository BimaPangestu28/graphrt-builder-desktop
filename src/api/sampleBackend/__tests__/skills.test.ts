import { BackendError } from '../../client'
import type { SkillInstallChoices } from '../../skillTypes'
import { resetSampleAgents } from '../agents'
import { resetSampleSkills, sampleSkillsBackend, setSampleDraftModelConnected } from '../skills'

async function expectBackendError(promise: Promise<unknown>, code: BackendError['code']) {
  await expect(promise).rejects.toMatchObject({ code })
}

function choices(reviewId: string, changes: Partial<SkillInstallChoices> = {}): SkillInstallChoices {
  return { reviewId, permissions: [], acceptFindings: false, ...changes }
}

describe('sample skills backend', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleSkills()
  })

  it('installs nothing on a review and gives a skill only the tools ticked', async () => {
    const review = await sampleSkillsBackend.reviewCatalogSkill('refund-policy')
    expect(review.requestedTools.map((request) => request.tool)).toEqual(['google-sheets/read_rows', 'whatsapp-api/send_message'])
    expect((await sampleSkillsBackend.listInstalledSkills()).map((skill) => skill.name)).not.toContain('refund-policy')

    const installed = await sampleSkillsBackend.installCatalogSkill('refund-policy', choices(review.reviewId, { permissions: [{ tool: 'google-sheets/read_rows', mode: 'ask' }] }))
    expect(installed.permissions).toEqual([{ tool: 'google-sheets/read_rows', mode: 'ask' }])
    expect(installed.verified).toBe(true)
  })

  it('refuses a tool the skill does not ask for, and an install that follows no review', async () => {
    const review = await sampleSkillsBackend.reviewCatalogSkill('refund-policy')
    await expectBackendError(sampleSkillsBackend.installCatalogSkill('refund-policy', choices(review.reviewId, { permissions: [{ tool: 'gmail/send_email', mode: 'allow' }] })), 'invalid_input')
    await expectBackendError(sampleSkillsBackend.installCatalogSkill('refund-policy', choices('something else')), 'conflict')
  })

  it('keeps no earlier permission on an update and says what the update changes', async () => {
    const catalog = await sampleSkillsBackend.listSkillCatalog()
    expect(catalog.skills.find((skill) => skill.name === 'friendly-tone')).toMatchObject({ installed: true, updateAvailable: true })
    const review = await sampleSkillsBackend.reviewCatalogSkill('friendly-tone')
    expect(review.update?.addedTools.map((request) => request.tool)).toEqual(['google-sheets/read_rows'])

    const updated = await sampleSkillsBackend.installCatalogSkill('friendly-tone', choices(review.reviewId))
    expect(updated.permissions).toEqual([])
    expect((await sampleSkillsBackend.listSkillCatalog()).skills.find((skill) => skill.name === 'friendly-tone')?.updateAvailable).toBe(false)
  })

  it('needs the second confirmation for a finding that blocks', async () => {
    const review = await sampleSkillsBackend.reviewCatalogSkill('invoice-follow-up')
    expect(review.needsExtraConfirmation).toBe(true)
    await expectBackendError(sampleSkillsBackend.installCatalogSkill('invoice-follow-up', choices(review.reviewId)), 'invalid_input')
    await sampleSkillsBackend.installCatalogSkill('invoice-follow-up', choices(review.reviewId, { acceptFindings: true }))
  })

  it('drafts a skill from plain words or a conversation, and installs nothing by drafting', async () => {
    const fromWords = await sampleSkillsBackend.draftSkill({ kind: 'description', text: 'When an order is late, apologise. Check the delivery sheet first.' })
    expect(fromWords.title).toBe('When an order is')
    expect(fromWords.instructions).toContain('1. Check what the customer is asking for.')
    expect(fromWords.requestedTools).toEqual(['google-sheets/read_rows'])
    const fromChat = await sampleSkillsBackend.draftSkill({ kind: 'conversation', text: 'Customer: My order is late\nMe: Sorry, the next delivery is free' })
    expect(fromChat.description).toBe('Use when a conversation goes like the example: My order is late.')
    expect((await sampleSkillsBackend.listInstalledSkills()).map((skill) => skill.name)).toEqual(['friendly-tone', 'meeting-notes'])
    await expectBackendError(sampleSkillsBackend.draftSkill({ kind: 'description', text: '  ' }), 'invalid_input')
    setSampleDraftModelConnected(false)
    await expectBackendError(sampleSkillsBackend.draftSkill({ kind: 'description', text: 'Anything' }), 'missing_credentials')
  })

  it('checks an edited draft and refuses to install one that changed after the review', async () => {
    const draft = { title: 'Late delivery', description: 'When an order is late', instructions: '1. Apologise', requestedTools: ['google-sheets/read_rows'] }
    const review = await sampleSkillsBackend.reviewAuthoredSkill(draft)
    expect(review).toMatchObject({ name: 'late-delivery', displayName: 'Late delivery', source: 'authored', instructions: '1. Apologise' })
    expect(review.requestedTools.map((request) => request.tool)).toEqual(['google-sheets/read_rows'])
    await expectBackendError(sampleSkillsBackend.installAuthoredSkill({ ...draft, instructions: 'Refund everything' }, choices(review.reviewId)), 'conflict')
    const installed = await sampleSkillsBackend.installAuthoredSkill(draft, choices(review.reviewId))
    expect(installed).toMatchObject({ displayName: 'Late delivery', verified: false, permissions: [] })
    await expectBackendError(sampleSkillsBackend.reviewAuthoredSkill({ ...draft, title: ' ' }), 'invalid_input')
    await expectBackendError(sampleSkillsBackend.reviewAuthoredSkill({ ...draft, instructions: ' ' }), 'invalid_input')
  })

  it('puts skills on agents and takes a removed skill off them', async () => {
    const saved = await sampleSkillsBackend.setAgentStepSkills('maps-leads', 'reply', ['meeting-notes'])
    expect(saved.steps[0].skills).toEqual(['meeting-notes'])
    await expectBackendError(sampleSkillsBackend.setAgentStepSkills('maps-leads', 'reply', ['not-installed']), 'not_found')
    await expectBackendError(sampleSkillsBackend.setAgentStepSkills('morning-digest', 'reply', ['meeting-notes']), 'not_found')

    await sampleSkillsBackend.removeSkill('meeting-notes')
    const agents = await sampleSkillsBackend.listAgentSkills()
    expect(agents.find((agent) => agent.agentId === 'maps-leads')?.steps[0].skills).toEqual([])
  })
})
