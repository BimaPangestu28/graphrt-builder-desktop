import { BackendError } from '../../client'
import type { SkillInstallChoices } from '../../skillTypes'
import { resetSampleAgents } from '../agents'
import { resetSampleSkills, sampleSkillsBackend } from '../skills'

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

  it('turns the form into a skill and refuses to install a form that changed', async () => {
    const form = { title: 'Late delivery', whenToUse: 'When an order is late', steps: ['Apologise', ''] }
    const review = await sampleSkillsBackend.reviewAuthoredSkill(form)
    expect(review).toMatchObject({ name: 'late-delivery', displayName: 'Late delivery', source: 'authored' })
    expect(review.instructions).toContain('1. Apologise')
    await expectBackendError(sampleSkillsBackend.installAuthoredSkill({ ...form, steps: ['Refund everything'] }, choices(review.reviewId)), 'conflict')
    const installed = await sampleSkillsBackend.installAuthoredSkill(form, choices(review.reviewId))
    expect(installed).toMatchObject({ displayName: 'Late delivery', verified: false })
    await expectBackendError(sampleSkillsBackend.reviewAuthoredSkill({ ...form, title: ' ' }), 'invalid_input')
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
