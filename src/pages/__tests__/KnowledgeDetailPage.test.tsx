import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleKnowledge, sampleKnowledgeBackend } from '@/api/sampleBackend/knowledge'
import { agentPath, knowledgeDetailPattern, routePaths } from '@/routes'
import { KnowledgeDetailPage } from '../KnowledgeDetailPage'

function renderKnowledgeDetail(path: string = routePaths.knowledgeDetail) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={knowledgeDetailPattern} element={<KnowledgeDetailPage />} />
        <Route path={routePaths.knowledge} element={<p>Knowledge list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function findSourcesTable() {
  await screen.findByText('Menu November.pdf')
  return screen.getByRole('table')
}

describe('KnowledgeDetailPage', () => {
  beforeEach(() => {
    resetSampleKnowledge()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the knowledge base and its sources', async () => {
    renderKnowledgeDetail()
    expect(screen.getByRole('heading', { level: 1, name: 'Loading…' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Catering menu and prices' })).toBeInTheDocument()
    const table = await findSourcesTable()
    expect(within(table).getByText('1 page failed')).toBeInTheDocument()
    expect(within(table).getAllByText('Ready')).toHaveLength(3)
    expect(screen.getByText('412 passages · 9.4 MB on disk · last synced 13:02')).toBeInTheDocument()
    const usedBy = screen.getByRole('region', { name: 'Used by' })
    expect(within(usedBy).getByRole('link', { name: /Catering assistant/ })).toHaveAttribute('href', agentPath('builder', 'catering-assistant'))
  })

  it('adds a picked file and shows it reading, then ready', async () => {
    const addSourceSpy = vi.spyOn(sampleKnowledgeBackend, 'addKnowledgeSource')
    renderKnowledgeDetail()
    const table = await findSourcesTable()
    fireEvent.change(screen.getByLabelText('Choose files to add as sources'), { target: { files: [new File(['menu'], 'Menu December.pdf')] } })

    const newRow = (await within(table).findByText('Menu December.pdf')).closest('tr') as HTMLElement
    expect(addSourceSpy).toHaveBeenCalledWith('menu-and-prices', 'file', 'Menu December.pdf')
    expect(within(newRow).getByText(/Reading…/)).toBeInTheDocument()
    await waitFor(() => expect(within(newRow).getByText('Ready')).toBeInTheDocument(), { timeout: 2000 })
    expect(within(newRow).getByText('24')).toBeInTheDocument()
  })

  it('adds a website link as a source', async () => {
    renderKnowledgeDetail()
    const table = await findSourcesTable()
    fireEvent.change(screen.getByLabelText('Website link to add'), { target: { value: 'https://example.com/faq' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(await within(table).findByText('example.com/faq')).toBeInTheDocument()
  })

  it('rejects text that is not a link before calling the backend', async () => {
    const addSourceSpy = vi.spyOn(sampleKnowledgeBackend, 'addKnowledgeSource')
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.change(screen.getByLabelText('Website link to add'), { target: { value: 'my website' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(await screen.findByText('Paste a link that starts with https://')).toBeInTheDocument()
    expect(addSourceSpy).not.toHaveBeenCalled()
  })

  it('removes a source', async () => {
    renderKnowledgeDetail()
    const table = await findSourcesTable()
    fireEvent.click(within(table).getByRole('button', { name: 'Remove Price list.xlsx' }))
    await waitFor(() => expect(within(table).queryByText('Price list.xlsx')).not.toBeInTheDocument())
  })

  it('syncs on request', async () => {
    const syncSpy = vi.spyOn(sampleKnowledgeBackend, 'syncKnowledgeBase')
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(syncSpy).toHaveBeenCalledWith('menu-and-prices'))
  })

  it('flags a weak match below the threshold and accepts it when the threshold is lowered', async () => {
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Test a question' }), { target: { value: 'ada menu vegetarian?' } })
    expect(await screen.findByText('Best match is weak. Paket Komplit includes chicken or fish')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ignore matches below'), { target: { value: '0.3' } })
    expect(screen.getByText('Paket Komplit includes chicken or fish')).toBeInTheDocument()
  })

  it('says when nothing answers the test question', async () => {
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Test a question' }), { target: { value: 'opening hours' } })
    expect(await screen.findByText('Nothing in this knowledge base answers that yet')).toBeInTheDocument()
  })

  it('saves settings through the backend', async () => {
    const settingsSpy = vi.spyOn(sampleKnowledgeBackend, 'updateKnowledgeSettings')
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.change(screen.getByLabelText('Passages per answer'), { target: { value: '8' } })
    await waitFor(() => expect(settingsSpy).toHaveBeenCalledWith('menu-and-prices', expect.objectContaining({ passagesPerAnswer: 8 })))
    expect(await screen.findByDisplayValue('8')).toBeInTheDocument()
  })

  it('shows a backend error from an action', async () => {
    vi.spyOn(sampleKnowledgeBackend, 'updateKnowledgeSettings').mockRejectedValue(
      new BackendError('invalid_input', 'invalid input: add an OpenAI key in Settings to use OpenAI embeddings'),
    )
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.change(screen.getByLabelText('Embedding model'), { target: { value: 'openai' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('add an OpenAI key in Settings')
  })

  it('shows an error for an unknown knowledge base', async () => {
    renderKnowledgeDetail('/knowledge/missing')
    expect(await screen.findByText(/Could not load this knowledge base: knowledge base missing not found/)).toBeInTheDocument()
  })

  it('deletes the knowledge base after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderKnowledgeDetail()
    await findSourcesTable()
    fireEvent.click(screen.getByRole('button', { name: 'Delete knowledge base' }))
    expect(await screen.findByText('Knowledge list')).toBeInTheDocument()
    expect((await sampleKnowledgeBackend.listKnowledgeBases()).map((knowledgeBase) => knowledgeBase.id)).not.toContain('menu-and-prices')
  })
})
