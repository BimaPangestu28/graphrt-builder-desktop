import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleSkills, sampleSkillsBackend } from '@/api/sampleBackend/skills'
import { setLocale } from '@/i18n'
import { routePaths, skillAddPath, skillAddPattern, skillDetailPath, skillDetailPattern } from '@/routes'
import { SkillsPage } from '../SkillsPage'

function renderSkillsPage(initialPath: string = routePaths.skills) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePaths.skills} element={<SkillsPage />} />
        <Route path={routePaths.skillCreate} element={<h1>Create wizard</h1>} />
        <Route path={skillAddPattern} element={<h1>Add wizard</h1>} />
        <Route path={skillDetailPattern} element={<h1>Skill page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SkillsPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleSkills()
  })

  it('explains skills and shows your skills as cards with who uses them', async () => {
    renderSkillsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByText(/It never runs code, and it uses a tool only if you allow it/)).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Your skills' })
    expect(within(list).getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Friendly tone', 'Meeting notes'])
    const friendlyTone = within(list).getByRole('article', { name: 'Friendly tone' })
    expect(within(friendlyTone).getByText('Update available')).toBeInTheDocument()
    expect(within(friendlyTone).getByText('From the Graphrt catalog · By graphrt')).toBeInTheDocument()
    expect(within(friendlyTone).getByText('Used by 1 agent')).toBeInTheDocument()
    expect(within(friendlyTone).getByRole('link', { name: 'Review the update of Friendly tone' })).toHaveAttribute('href', skillAddPath('friendly-tone'))
    const meetingNotes = within(list).getByRole('article', { name: 'Meeting notes' })
    expect(within(meetingNotes).getByText('Written here')).toBeInTheDocument()
    expect(within(meetingNotes).getByText('Not used by an agent yet')).toBeInTheDocument()
    expect(within(meetingNotes).getByRole('link', { name: 'Open Meeting notes' })).toHaveAttribute('href', skillDetailPath('meeting-notes'))
  })

  it('lists the catalog on its tab with one action per card', async () => {
    renderSkillsPage()
    await screen.findByRole('list', { name: 'Your skills' })
    await userEvent.click(screen.getByRole('tab', { name: /From the catalog/ }))
    const list = screen.getByRole('list', { name: 'Skills from the catalog' })
    expect(within(list).getAllByRole('article')).toHaveLength(3)
    const refunds = within(list).getByRole('article', { name: 'Refund policy' })
    expect(within(refunds).getByText('By graphrt · Version 1.2.0')).toBeInTheDocument()
    expect(within(refunds).getByRole('link', { name: 'Add Refund policy' })).toHaveAttribute('href', skillAddPath('refund-policy'))
    expect(within(list).getByRole('article', { name: 'Friendly tone' })).toHaveTextContent('Update available')
  })

  it('opens the create wizard from the header', async () => {
    renderSkillsPage()
    await userEvent.click(screen.getByRole('link', { name: 'Create a skill' }))
    expect(screen.getByRole('heading', { name: 'Create wizard' })).toBeInTheDocument()
  })

  it('says how to start when there are no skills yet', async () => {
    await sampleSkillsBackend.removeSkill('friendly-tone')
    await sampleSkillsBackend.removeSkill('meeting-notes')
    renderSkillsPage()
    expect(await screen.findByText('No skills yet. Add one from the catalog or create your own')).toBeInTheDocument()
  })

  it('keeps your skills on screen when the catalog cannot be loaded', async () => {
    vi.spyOn(sampleSkillsBackend, 'listSkillCatalog').mockRejectedValue(new Error('offline'))
    renderSkillsPage(`${routePaths.skills}?tab=catalog`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the catalog: offline. Your skills still work')
    await userEvent.click(screen.getByRole('tab', { name: /Your skills/ }))
    expect(screen.getByRole('article', { name: 'Meeting notes' })).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('is translated', async () => {
    setLocale('id')
    renderSkillsPage()
    expect(screen.getByRole('link', { name: 'Buat skill' })).toBeInTheDocument()
    expect(await screen.findByText('Dipakai 1 agent')).toBeInTheDocument()
  })
})
