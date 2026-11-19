import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BackendError } from '@/api/client'
import { resetSampleCrashReports, sampleCrashReportsBackend } from '@/api/sampleBackend/crashReports'
import { CrashReportsPanel } from './CrashReportsPanel'

async function saveSampleReport(message: string) {
  await sampleCrashReportsBackend.reportFrontendError({ message, stack: null, componentStack: null, route: '/home', source: 'window_error' })
}

describe('CrashReportsPanel', () => {
  beforeEach(() => resetSampleCrashReports())
  afterEach(() => vi.restoreAllMocks())

  it('says graphrt sends no telemetry and that there are no reports yet', async () => {
    render(<CrashReportsPanel />)
    expect(screen.getByText(/graphrt sends no telemetry/)).toBeInTheDocument()
    expect(await screen.findByText('No crash reports on this computer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeDisabled()
  })

  it('lists the reports and shows the scrubbed JSON on View', async () => {
    await saveSampleReport('TypeError: x is undefined')
    render(<CrashReportsPanel />)
    const reportList = await screen.findByRole('list', { name: 'Saved crash reports' })
    expect(within(reportList).getByText('TypeError: x is undefined')).toBeInTheDocument()
    fireEvent.click(within(reportList).getByRole('button', { name: /View the crash report/ }))
    const viewer = await screen.findByRole('dialog', { name: 'Crash report' })
    expect(await within(viewer).findByLabelText('Crash report contents')).toHaveTextContent('"message": "TypeError: x is undefined"')
  })

  it('deletes every report after asking first', async () => {
    await saveSampleReport('one')
    await saveSampleReport('two')
    render(<CrashReportsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete crash reports' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 2 crash reports')
    expect(await screen.findByText('No crash reports on this computer')).toBeInTheDocument()
  })

  it('exports every report to the chosen file', async () => {
    await saveSampleReport('one')
    const exportSpy = vi.spyOn(sampleCrashReportsBackend, 'exportCrashReports')
    render(<CrashReportsPanel />)
    await screen.findByRole('list', { name: 'Saved crash reports' })
    fireEvent.click(screen.getByRole('button', { name: 'Export all' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Exported 1 crash report to ~\/Downloads\/graphrt-crash-reports-.*\.json/)
    expect(exportSpy).toHaveBeenCalledWith(expect.stringMatching(/graphrt-crash-reports-\d{4}-\d{2}-\d{2}\.json$/))
  })

  it('saves the sharing opt-in, off by default', async () => {
    render(<CrashReportsPanel />)
    const sharingToggle = await screen.findByRole('checkbox', { name: /offer to share crash reports/ })
    expect(sharingToggle).not.toBeChecked()
    fireEvent.click(sharingToggle)
    await waitFor(async () => expect(await sampleCrashReportsBackend.getCrashReportSharing()).toBe(true))
    expect(sharingToggle).toBeChecked()
  })

  it('puts the opt-in back when saving fails', async () => {
    vi.spyOn(sampleCrashReportsBackend, 'setCrashReportSharing').mockRejectedValueOnce(new BackendError('database', 'disk is full'))
    render(<CrashReportsPanel />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /offer to share crash reports/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change: disk is full')
    expect(screen.getByRole('checkbox', { name: /offer to share crash reports/ })).not.toBeChecked()
  })
})
