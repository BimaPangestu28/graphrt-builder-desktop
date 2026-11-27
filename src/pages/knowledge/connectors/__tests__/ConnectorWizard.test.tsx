import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleKnowledge } from '@/api/sampleBackend/knowledge'
import { sampleKnowledgeConnectorBackend } from '@/api/sampleBackend/knowledgeConnectors'
import { knowledgeDetailPattern, routePaths } from '@/routes'
import { KnowledgeDetailPage } from '@/pages/KnowledgeDetailPage'

function renderDetail(knowledgeBaseId: string) {
  return render(
    <MemoryRouter initialEntries={[routePaths.knowledgeDetail.replace('menu-and-prices', knowledgeBaseId)]}>
      <Routes>
        <Route path={knowledgeDetailPattern} element={<KnowledgeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('connecting knowledge sources', () => {
  beforeEach(() => {
    resetSampleKnowledge()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows connector sources with their schedule, translated errors and a sync button', async () => {
    const syncSpy = vi.spyOn(sampleKnowledgeConnectorBackend, 'syncKnowledgeSource')
    renderDetail('team-wiki')
    const table = await screen.findByRole('table')
    const driveRow = (await within(table).findByText('Folder Menu (Google Drive)')).closest('tr') as HTMLElement
    expect(within(driveRow).getByText('The sign-in expired or was refused. Connect the account again.')).toBeInTheDocument()
    expect(within(driveRow).getByText(/9 files · dapur@cateringku.example/)).toBeInTheDocument()
    const notionRow = within(table).getByText('Wiki tim dapur').closest('tr') as HTMLElement
    expect(within(notionRow).getByText(/Syncs every 6 hours · next/)).toBeInTheDocument()
    fireEvent.click(within(notionRow).getByRole('button', { name: 'Sync Wiki tim dapur now' }))
    await waitFor(() => expect(syncSpy).toHaveBeenCalledWith('notion-wiki'))
  })

  it('connects a website in three steps and starts its first sync', async () => {
    const addSpy = vi.spyOn(sampleKnowledgeConnectorBackend, 'addConnectorSource')
    renderDetail('menu-and-prices')
    const card = await screen.findByRole('region', { name: 'Connect a source' })
    fireEvent.click(within(card).getByRole('button', { name: /Website/ }))
    const dialog = screen.getByRole('dialog', { name: 'Website' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Paste a link that starts with https://')
    fireEvent.change(within(dialog).getByLabelText('Web address'), { target: { value: 'https://cateringku.example/' } })
    fireEvent.click(within(dialog).getByLabelText('Every page of the sitemap'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(dialog).getByLabelText('Every day at'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect and sync' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(addSpy).toHaveBeenCalledWith(
      'menu-and-prices',
      expect.objectContaining({
        kind: 'website',
        options: { urls: ['https://cateringku.example/'], mode: 'sitemap', max_depth: 0, max_pages: 100 },
        schedule: expect.objectContaining({ daily: '06:00' }),
      }),
    )
    expect(await screen.findByText('cateringku.example')).toBeInTheDocument()
  })

  it('signs in to Google before a Drive folder can be connected', async () => {
    const signInSpy = vi.spyOn(sampleKnowledgeConnectorBackend, 'signInConnector')
    renderDetail('menu-and-prices')
    const card = await screen.findByRole('region', { name: 'Connect a source' })
    fireEvent.click(within(card).getByRole('button', { name: /Google Drive/ }))
    const dialog = screen.getByRole('dialog', { name: 'Google Drive' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Sign in first')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in with Google' }))
    expect(await within(dialog).findByText('Signed in as kamu@contoh.co.id')).toBeInTheDocument()
    expect(signInSpy).toHaveBeenCalledWith('google')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByText('Keep it up to date')).toBeInTheDocument()
  })
})
