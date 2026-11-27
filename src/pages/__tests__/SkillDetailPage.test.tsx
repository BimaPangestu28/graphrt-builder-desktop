import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleSkills, sampleSkillsBackend } from '@/api/sampleBackend/skills'
import { routePaths, skillAddPath, skillAddPattern, skillDetailPath, skillDetailPattern, skillEditPath } from '@/routes'
import { SkillDetailPage } from '../SkillDetailPage'

function renderSkillPage(skillName: string) {
  return render(
    <MemoryRouter initialEntries={[skillDetailPath(skillName)]}>
      <Routes>
        <Route path={skillDetailPattern} element={<SkillDetailPage />} />
        <Route path={routePaths.skills} element={<h1>Skills list</h1>} />
        <Route path={skillAddPattern} element={<h1>Add wizard</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function installRefundPolicy() {
  const review = await sampleSkillsBackend.reviewCatalogSkill('refund-policy')
  await sampleSkillsBackend.installCatalogSkill('refund-policy', { reviewId: review.reviewId, permissions: [{ tool: 'google-sheets/read_rows', mode: 'ask' }], acceptFindings: false })
}

describe('SkillDetailPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleSkills()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the skill, where it came from and an update waiting', async () => {
    renderSkillPage('friendly-tone')
    expect(await screen.findByRole('heading', { level: 1, name: /Friendly tone/ })).toBeInTheDocument()
    expect(screen.getByText(/From the Graphrt catalog · By graphrt · Version 1\.0\.0 · Added/)).toBeInTheDocument()
    expect(screen.getByText('The catalog has a newer version of this skill.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review update' })).toHaveAttribute('href', skillAddPath('friendly-tone'))
  })

  it('offers to change the wording of a skill written here, and not of a catalog skill', async () => {
    const { unmount } = renderSkillPage('meeting-notes')
    expect(await screen.findByRole('link', { name: 'Change the wording' })).toHaveAttribute('href', skillEditPath('meeting-notes'))
    unmount()
    renderSkillPage('friendly-tone')
    await screen.findByRole('heading', { level: 1, name: /Friendly tone/ })
    expect(screen.queryByRole('link', { name: 'Change the wording' })).not.toBeInTheDocument()
  })

  it('changes what the skill may use only when the choices are saved', async () => {
    await installRefundPolicy()
    renderSkillPage('refund-policy')
    const sheets = await screen.findByRole('checkbox', { name: 'Allow Google Sheets · Read rows' })
    expect(sheets).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Allow WhatsApp Cloud API · Send message' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save choices' })).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: /Use it without asking/ }))
    expect((await sampleSkillsBackend.listInstalledSkills()).find((skill) => skill.name === 'refund-policy')?.permissions).toEqual([{ tool: 'google-sheets/read_rows', mode: 'ask' }])
    await userEvent.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect((await sampleSkillsBackend.listInstalledSkills()).find((skill) => skill.name === 'refund-policy')?.permissions).toEqual([{ tool: 'google-sheets/read_rows', mode: 'allow' }])
  })

  it('turns the skill off and on', async () => {
    renderSkillPage('meeting-notes')
    const toggle = await screen.findByRole('checkbox', { name: 'Agents may use Meeting notes' })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    expect(await screen.findByText(/This skill is off, so no agent uses it/)).toBeInTheDocument()
    expect((await sampleSkillsBackend.listInstalledSkills()).find((skill) => skill.name === 'meeting-notes')?.enabled).toBe(false)
  })

  it('takes the skill on and off agents, and says when the builder is busy', async () => {
    renderSkillPage('friendly-tone')
    const agents = await screen.findByRole('list', { name: 'Agents that can use this skill' })
    expect(within(agents).getByRole('checkbox', { name: 'Catering assistant' })).toBeChecked()
    await userEvent.click(within(agents).getByRole('checkbox', { name: 'Catering assistant' }))
    expect(await within(agents).findByRole('checkbox', { name: 'Catering assistant', checked: false })).toBeInTheDocument()

    vi.spyOn(sampleSkillsBackend, 'setAgentStepSkills').mockRejectedValueOnce(new BackendError('builder_busy', 'busy'))
    await userEvent.click(within(agents).getByRole('checkbox', { name: 'Catering sales team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The builder is changing Catering sales team right now. Try again when it is done.')
  })

  it('removes the skill only after a second click', async () => {
    renderSkillPage('meeting-notes')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove skill' }))
    expect(screen.getByText('Remove Meeting notes? It is taken off every agent that uses it.')).toBeInTheDocument()
    expect((await sampleSkillsBackend.listInstalledSkills()).map((skill) => skill.name)).toContain('meeting-notes')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('heading', { name: 'Skills list' })).toBeInTheDocument()
    expect((await sampleSkillsBackend.listInstalledSkills()).map((skill) => skill.name)).not.toContain('meeting-notes')
  })

  it('says when the skill is not on this computer', async () => {
    renderSkillPage('nope')
    expect(await screen.findByText('This skill is not on this computer.')).toBeInTheDocument()
  })
})
