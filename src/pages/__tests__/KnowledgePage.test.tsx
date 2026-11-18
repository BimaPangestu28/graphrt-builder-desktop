import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleKnowledge, sampleKnowledgeBackend } from '@/api/sampleBackend/knowledge'
import { routePaths } from '@/routes'
import { KnowledgePage, nameForNewKnowledgeBase } from '../KnowledgePage'

function renderKnowledge() {
  return render(
    <MemoryRouter>
      <KnowledgePage />
    </MemoryRouter>,
  )
}

describe('KnowledgePage', () => {
  beforeEach(() => {
    resetSampleKnowledge()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading, then the knowledge bases linking to their detail', async () => {
    renderKnowledge()
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.getByText('Loading knowledge…')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Catering menu and prices/ })).toHaveAttribute('href', routePaths.knowledgeDetail)
    expect(screen.getByText('Syncing 64%')).toBeInTheDocument()
    expect(screen.getByText('412 passages')).toBeInTheDocument()
    expect(screen.getByText('Used by Catering assistant, Maps leads to WhatsApp')).toBeInTheDocument()
    expect(screen.queryByText('Loading knowledge…')).not.toBeInTheDocument()
  })

  it('searches every knowledge base as you type', async () => {
    renderKnowledge()
    const searchBox = screen.getByRole('searchbox', { name: 'Search knowledge' })
    fireEvent.change(searchBox, { target: { value: 'minimum order for free delivery' } })
    expect(await screen.findByText('0.91')).toBeInTheDocument()
    expect(screen.getByText('0.74')).toBeInTheDocument()
    expect(screen.getByText('Menu November.pdf · page 11 · Catering menu and prices')).toBeInTheDocument()
    fireEvent.change(searchBox, { target: { value: 'opening hours' } })
    expect(await screen.findByText('Nothing in your knowledge matches this yet')).toBeInTheDocument()
  })

  it('creates a knowledge base from picked files and starts indexing them', async () => {
    const createSpy = vi.spyOn(sampleKnowledgeBackend, 'createKnowledgeBase')
    const addSourceSpy = vi.spyOn(sampleKnowledgeBackend, 'addKnowledgeSource')
    renderKnowledge()
    await screen.findByRole('link', { name: /Catering menu and prices/ })
    const pickedFile = new File(['menu'], 'Menu December.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Choose files for a new knowledge base'), { target: { files: [pickedFile] } })

    const newCard = await screen.findByRole('link', { name: /Menu December\.pdf/ })
    expect(createSpy).toHaveBeenCalledWith('Menu December.pdf', '')
    expect(addSourceSpy).toHaveBeenCalledWith(expect.stringMatching(/^kb_sample_/), 'file', 'Menu December.pdf')
    expect(await within(newCard).findByText(/Syncing|Up to date/)).toBeInTheDocument()
  })

  it('starts a knowledge base from a website link', async () => {
    const addSourceSpy = vi.spyOn(sampleKnowledgeBackend, 'addKnowledgeSource')
    renderKnowledge()
    await screen.findByRole('link', { name: /Catering menu and prices/ })
    fireEvent.change(screen.getByLabelText('Website link for a new knowledge base'), { target: { value: 'https://example.com/menu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start from a link' }))
    expect(await screen.findByRole('link', { name: /example\.com/ })).toBeInTheDocument()
    expect(addSourceSpy).toHaveBeenCalledWith(expect.any(String), 'url', 'https://example.com/menu')
  })

  it('shows an error when the knowledge bases cannot load', async () => {
    vi.spyOn(sampleKnowledgeBackend, 'listKnowledgeBases').mockRejectedValue(new BackendError('database', 'database error: disk full'))
    renderKnowledge()
    expect(await screen.findByText(/Could not load your knowledge: database error: disk full/)).toBeInTheDocument()
  })

  it('shows why a new knowledge base could not be created', async () => {
    vi.spyOn(sampleKnowledgeBackend, 'addKnowledgeSource').mockRejectedValue(new BackendError('invalid_input', 'invalid input: notes.bin is not a supported file type'))
    renderKnowledge()
    await screen.findByRole('link', { name: /Catering menu and prices/ })
    fireEvent.change(screen.getByLabelText('Choose files for a new knowledge base'), { target: { files: [new File(['x'], 'notes.bin')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('notes.bin is not a supported file type')
  })
})

describe('nameForNewKnowledgeBase', () => {
  it('names a knowledge base after its only source', () => {
    expect(nameForNewKnowledgeBase([{ kind: 'file', location: '/Users/me/Menu.pdf' }])).toBe('Menu.pdf')
    expect(nameForNewKnowledgeBase([{ kind: 'folder', location: '/Users/me/Kantor/' }])).toBe('Kantor')
    expect(nameForNewKnowledgeBase([{ kind: 'url', location: 'https://example.com/menu' }])).toBe('example.com')
    expect(nameForNewKnowledgeBase([])).toBe('New knowledge base')
  })
})
