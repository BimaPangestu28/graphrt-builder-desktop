import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as runSummaryApi from '@/api/runSummary'
import type { RunFile } from '@/api/runSummaryTypes'
import { RunFilesCard } from './RunFilesCard'

const invoice: RunFile = { path: '/home/sari/Invoices/2026/11/INV-2026-0001.pdf', name: 'INV-2026-0001.pdf', folder: '/home/sari/Invoices/2026/11', canOpen: true }

describe('RunFilesCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing for a run that made no file', () => {
    const { container } = render(<RunFilesCard runId="run-1" files={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says where the file is and opens it or its folder', async () => {
    const openFile = vi.spyOn(runSummaryApi, 'openRunFile').mockResolvedValue()
    const openFolder = vi.spyOn(runSummaryApi, 'openRunFileFolder').mockResolvedValue()
    render(<RunFilesCard runId="run-1" files={[invoice]} />)

    expect(screen.getByRole('region', { name: 'File from this run' })).toBeInTheDocument()
    expect(screen.getByText('INV-2026-0001.pdf')).toBeInTheDocument()
    expect(screen.getByText('Saved in /home/sari/Invoices/2026/11')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open INV-2026-0001.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open the folder of INV-2026-0001.pdf' }))
    await waitFor(() => expect(openFolder).toHaveBeenCalledWith('run-1', invoice.path))
    expect(openFile).toHaveBeenCalledWith('run-1', invoice.path)
  })

  it('offers only the folder for a file the app does not open, and says when opening fails', async () => {
    vi.spyOn(runSummaryApi, 'openRunFileFolder').mockRejectedValue(new Error('the folder is gone'))
    render(<RunFilesCard runId="run-1" files={[{ ...invoice, name: 'export.sh', canOpen: false }]} />)
    expect(screen.queryByRole('button', { name: 'Open export.sh' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the folder of export.sh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open export.sh: the folder is gone')
  })
})
