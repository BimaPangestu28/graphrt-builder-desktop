import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as agentFilesApi from '@/api/agentFiles'
import type { FileCard, FilePreview } from '@/api/agentFileTypes'
import { BackendError } from '@/api/client'
import { FileCardGrid } from '../FileCardGrid'
import { clearFilePreviewCache } from '../useFilePreview'

const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQ'

function card(overrides: Partial<FileCard>): FileCard {
  return { reference: 'workspace:reports/q3.pdf', name: 'q3.pdf', sizeBytes: 184_320, mimeType: 'application/pdf', kind: 'pdf', preview: 'none', ...overrides }
}

const pdf = card({})
const photo = card({ reference: 'workspace:uploads/venue.jpg', name: 'venue.jpg', mimeType: 'image/jpeg', kind: 'picture', preview: 'picture' })
const webPage = card({ reference: 'workspace:page.html', name: 'page.html', mimeType: 'text/html', kind: 'web_page', preview: 'none' })
const longName = 'Laporan penjualan kuartal ketiga tahun 2026 untuk rapat direksi (final revisi 4).xlsx'

function mockPreview(preview: FilePreview) {
  return vi.spyOn(agentFilesApi, 'previewAgentFile').mockResolvedValue(preview)
}

describe('FileCardGrid', () => {
  beforeEach(() => clearFilePreviewCache())
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing without files', () => {
    const { container } = render(<FileCardGrid agentId="agent-1" cards={[]} label="Files the agent made" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each file with its name, kind and size on single lines', () => {
    render(<FileCardGrid agentId="agent-1" cards={[pdf, card({ reference: 'workspace:long.xlsx', name: longName, kind: 'spreadsheet' })]} label="Files the agent made" />)
    const group = screen.getByRole('region', { name: 'Files the agent made' })
    expect(within(group).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('PDF · 180 KB')).toHaveClass('truncate')
    // The long name is cut with an ellipsis; the tooltip has all of it.
    const name = screen.getByText(longName)
    expect(name).toHaveClass('truncate')
    expect(name).toHaveAttribute('title', longName)
    expect(screen.getByRole('button', { name: `Download ${longName}` })).toHaveClass('whitespace-nowrap')
  })

  it('lays the cards out in two columns, three when the group is wide', () => {
    render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" />)
    expect(screen.getByRole('region', { name: 'Files' })).toHaveClass('@container', 'ui-block')
    expect(screen.getByRole('listitem')).toHaveClass('w-[calc((100%-0.5rem)/2)]', '@md:w-[calc((100%-1rem)/3)]')
  })

  it('starts a row that is not full from the side of its message', () => {
    const { unmount } = render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" align="end" />)
    expect(screen.getByRole('list')).toHaveClass('justify-end')
    unmount()
    render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" />)
    expect(screen.getByRole('list')).not.toHaveClass('justify-end')
  })

  it('shows a small picture for a raster picture only', async () => {
    const previewAgentFile = mockPreview({ kind: 'picture', dataUrl: jpegDataUrl, width: 64, height: 40 })
    render(<FileCardGrid agentId="agent-1" cards={[photo, pdf, webPage]} label="Files" />)
    const picture = await screen.findByRole('img', { name: 'Preview of venue.jpg' })
    expect(picture).toHaveAttribute('src', jpegDataUrl)
    // Only the picture was asked for: a PDF and a web page are never previewed.
    expect(previewAgentFile).toHaveBeenCalledTimes(1)
    expect(previewAgentFile).toHaveBeenCalledWith('agent-1', photo.reference)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it.each([
    ['an SVG', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['an HTML page', 'data:text/html;base64,PGgxPg=='],
    ['a remote address', 'https://evil.test/pixel.png'],
    ['a script', 'javascript:alert(1)'],
  ])('never shows %s as a preview, whatever the backend answers', async (_, dataUrl) => {
    const previewAgentFile = mockPreview({ kind: 'picture', dataUrl, width: 1, height: 1 })
    render(<FileCardGrid agentId="agent-1" cards={[photo]} label="Files" />)
    await waitFor(() => expect(previewAgentFile).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('iframe, object, embed, script')).toBeNull()
    expect(screen.getByRole('button', { name: 'Download venue.jpg' })).toBeInTheDocument()
  })

  it('shows a file name as text, never as markup', () => {
    const markupName = '<img src=x onerror=alert(1)>.pdf'
    render(<FileCardGrid agentId="agent-1" cards={[card({ name: markupName })]} label="Files" />)
    expect(screen.getByText(markupName)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('asks for a preview once per file', async () => {
    const previewAgentFile = mockPreview({ kind: 'picture', dataUrl: jpegDataUrl, width: 64, height: 40 })
    const first = render(<FileCardGrid agentId="agent-1" cards={[photo]} label="Files" />)
    await screen.findByRole('img')
    first.unmount()
    render(<FileCardGrid agentId="agent-1" cards={[photo]} label="Files" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', jpegDataUrl)
    expect(previewAgentFile).toHaveBeenCalledTimes(1)
  })

  it('saves a file through its reference and says so', async () => {
    const saveAgentFile = vi.spyOn(agentFilesApi, 'saveAgentFile').mockResolvedValue({ saved: true, fileName: 'q3.pdf' })
    render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download q3.pdf' }))
    })
    expect(saveAgentFile).toHaveBeenCalledWith('agent-1', 'workspace:reports/q3.pdf', 'Save q3.pdf')
    expect(screen.getByRole('button', { name: 'Download q3.pdf' })).toHaveTextContent('Saved')
  })

  it('stays as it was when the save dialog is closed', async () => {
    vi.spyOn(agentFilesApi, 'saveAgentFile').mockResolvedValue({ saved: false, fileName: null })
    render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download q3.pdf' }))
    })
    expect(screen.getByRole('button', { name: 'Download q3.pdf' })).toHaveTextContent('Download')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says why a file could not be saved, on one line', async () => {
    vi.spyOn(agentFilesApi, 'saveAgentFile').mockRejectedValue(new BackendError('not_found', 'that file not found'))
    render(<FileCardGrid agentId="agent-1" cards={[pdf]} label="Files" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download q3.pdf' }))
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not save q3.pdf: that file not found')
    expect(alert).toHaveClass('truncate')
    expect(screen.getByRole('button', { name: 'Download q3.pdf' })).toBeEnabled()
  })
})
