import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleKnowledge, sampleKnowledgeBackend } from '@/api/sampleBackend/knowledge'
import { knowledgeDetailPattern, routePaths } from '@/routes'
import { KnowledgeDetailPage } from '../KnowledgeDetailPage'
import { chunkingProblem, chunkingSettingsEqual, defaultChunkingSettings } from '../knowledge/chunkingSettings'

function renderIndexingTab() {
  return render(
    <MemoryRouter initialEntries={[`${routePaths.knowledgeDetail}?view=indexing`]}>
      <Routes>
        <Route path={knowledgeDetailPattern} element={<KnowledgeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openAdvancedSettings() {
  fireEvent.click(await screen.findByRole('button', { name: /Advanced settings/ }))
}

describe('Knowledge indexing tab', () => {
  beforeEach(() => {
    resetSampleKnowledge()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens from the tab bar and shows totals and the documents', async () => {
    render(
      <MemoryRouter initialEntries={[routePaths.knowledgeDetail]}>
        <Routes>
          <Route path={knowledgeDetailPattern} element={<KnowledgeDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexing results' }))
    expect(screen.getByRole('tab', { name: 'Indexing results' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('412')).toBeInTheDocument()
    expect(screen.getByText('up to 250 tokens')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Menu November\.pdf/ })).toBeInTheDocument()
  })

  it('pages through the passages of the chosen document', async () => {
    const chunksSpy = vi.spyOn(sampleKnowledgeBackend, 'listKnowledgeChunks')
    renderIndexingTab()
    expect(await screen.findByRole('heading', { name: 'Passages of Menu November.pdf' })).toBeInTheDocument()
    expect(await screen.findByText('1–20 of 186')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Passage 1' })).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Passage 1' })).getByText('page 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('21–40 of 186')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Passage 21' })).toBeInTheDocument()
    expect(chunksSpy).toHaveBeenLastCalledWith('menu-november', 'menu-november', '', 20, 20)
  })

  it('filters passages by words', async () => {
    const chunksSpy = vi.spyOn(sampleKnowledgeBackend, 'listKnowledgeChunks')
    renderIndexingTab()
    await screen.findByText('1–20 of 186')
    const filter = screen.getByRole('searchbox', { name: 'Find in passages' })
    fireEvent.change(filter, { target: { value: 'Vegetarian' } })
    await waitFor(() => expect(chunksSpy).toHaveBeenLastCalledWith('menu-november', 'menu-november', 'Vegetarian', 0, 20))
    expect(await screen.findByText(/of 186 passages match/)).toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'durian' } })
    expect(await screen.findByText('No passage of this document contains these words')).toBeInTheDocument()
  })

  it('switches to another document', async () => {
    renderIndexingTab()
    fireEvent.click(await screen.findByRole('button', { name: /Price list\.xlsx/ }))
    expect(await screen.findByRole('heading', { name: 'Passages of Price list.xlsx' })).toBeInTheDocument()
    expect(await screen.findByText('1–20 of 84')).toBeInTheDocument()
  })

  it('saves new chunking, asks to index again and applies it', async () => {
    const settingsSpy = vi.spyOn(sampleKnowledgeBackend, 'updateKnowledgeSettings')
    renderIndexingTab()
    await openAdvancedSettings()
    fireEvent.change(screen.getByRole('spinbutton', { name: /Passage size/ }), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Never mix two PDF pages/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(settingsSpy).toHaveBeenCalledWith('menu-and-prices', expect.objectContaining({ chunking: expect.objectContaining({ maxTokens: 500, splitPages: true }) })),
    )
    expect(await screen.findByText('New chunking settings are saved')).toBeInTheDocument()
    expect(screen.getByText('Customized')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Index again' }))
    await waitFor(() => expect(screen.queryByText('New chunking settings are saved')).not.toBeInTheDocument(), { timeout: 5000 })
    // Bigger passages: fewer of them.
    expect(await screen.findByText('1–20 of 88')).toBeInTheDocument()
  })

  it('edits the separator list and goes back to the defaults', async () => {
    const settingsSpy = vi.spyOn(sampleKnowledgeBackend, 'updateKnowledgeSettings')
    renderIndexingTab()
    await openAdvancedSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Space between words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Line break up' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Separator to add' }), { target: { value: 'pattern' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of the new separator' }), { target: { value: '(?m)^Pasal \\d+' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Pattern (?m)^Pasal \\d+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(settingsSpy).toHaveBeenCalled())
    const saved = settingsSpy.mock.calls[0]?.[1].chunking
    expect(saved?.separators).toEqual([{ kind: 'line' }, { kind: 'paragraph' }, { kind: 'sentence' }, { kind: 'clause' }, { kind: 'pattern', value: '(?m)^Pasal \\d+' }])

    await screen.findByText('Customized')
    fireEvent.click(screen.getByRole('button', { name: 'Back to defaults' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(settingsSpy).toHaveBeenCalledTimes(2))
    expect(chunkingSettingsEqual(settingsSpy.mock.calls[1]?.[1].chunking ?? defaultChunkingSettings(), defaultChunkingSettings())).toBe(true)
    await waitFor(() => expect(screen.queryByText('Customized')).not.toBeInTheDocument())
  })

  it('refuses out-of-range values before saving', async () => {
    renderIndexingTab()
    await openAdvancedSettings()
    fireEvent.change(screen.getByRole('spinbutton', { name: /Overlap/ }), { target: { value: '200' } })
    expect(screen.getByRole('alert')).toHaveTextContent('The overlap can be at most half of the passage size')
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})

describe('chunkingProblem', () => {
  it('accepts the defaults and names the first problem', () => {
    const defaults = defaultChunkingSettings()
    expect(chunkingProblem(defaults)).toBeNull()
    expect(chunkingProblem({ ...defaults, maxTokens: 10 })).toMatch(/between 50 and 2000/)
    expect(chunkingProblem({ ...defaults, minTokens: 300 })).toMatch(/minimum size/)
    expect(chunkingProblem({ ...defaults, separators: [{ kind: 'text', value: '' }] })).toMatch(/cannot be empty/)
    expect(chunkingProblem({ ...defaults, separators: Array.from({ length: 13 }, () => ({ kind: 'word' as const })) })).toMatch(/at most 12/)
    expect(chunkingProblem({ ...defaults, maxTokens: Number.NaN })).not.toBeNull()
  })
})
