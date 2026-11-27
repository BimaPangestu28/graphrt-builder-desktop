import { render, screen, waitFor, within } from '@testing-library/react'
import * as agentFilesApi from '@/api/agentFiles'
import type { FileCard } from '@/api/agentFileTypes'
import { RunFileList } from '../RunFileList'

const report: FileCard = { reference: 'workspace:reports/q3.pdf', name: 'q3.pdf', sizeBytes: 184_320, mimeType: 'application/pdf', kind: 'pdf', preview: 'none' }

describe('RunFileList', () => {
  afterEach(() => vi.restoreAllMocks())

  it('offers the files a run made as downloads', async () => {
    const listRunFiles = vi.spyOn(agentFilesApi, 'listRunFiles').mockResolvedValue([report])
    render(<RunFileList agentId="agent-1" runId="run-7" />)
    expect(await screen.findByRole('heading', { name: 'Files the agent made' })).toBeInTheDocument()
    expect(listRunFiles).toHaveBeenCalledWith('run-7')
    const files = screen.getAllByRole('region', { name: 'Files the agent made' })
    expect(within(files[0]).getByRole('button', { name: 'Download q3.pdf' })).toBeInTheDocument()
  })

  it('renders nothing for a run without files', async () => {
    const listRunFiles = vi.spyOn(agentFilesApi, 'listRunFiles').mockResolvedValue([])
    const { container } = render(<RunFileList agentId="agent-1" runId="run-7" />)
    await waitFor(() => expect(listRunFiles).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the files cannot be listed, so the rest of the result still shows', async () => {
    const listRunFiles = vi.spyOn(agentFilesApi, 'listRunFiles').mockRejectedValue(new Error('offline'))
    const { container } = render(<RunFileList agentId="agent-1" runId="run-7" />)
    await waitFor(() => expect(listRunFiles).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
