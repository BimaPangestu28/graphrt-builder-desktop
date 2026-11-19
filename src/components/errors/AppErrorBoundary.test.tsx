import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetSampleCrashReports, sampleCrashReportsBackend } from '@/api/sampleBackend/crashReports'
import { resetFrontendErrorReporting } from '@/lib/frontendErrorReporting'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenScreen(): never {
  throw new Error('agent list is undefined')
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    resetSampleCrashReports()
    resetFrontendErrorReporting()
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows its children when nothing breaks', () => {
    render(
      <AppErrorBoundary>
        <p>Home</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('shows a friendly fallback with Reload and saves a crash report', async () => {
    const reportSpy = vi.spyOn(sampleCrashReportsBackend, 'reportFrontendError')
    const handleReload = vi.fn()
    window.location.hash = '#/agents/a1/run?input=my-secret'
    render(
      <AppErrorBoundary onReload={handleReload}>
        <BrokenScreen />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(handleReload).toHaveBeenCalledOnce()
    await waitFor(() => expect(reportSpy).toHaveBeenCalledOnce())
    const sentReport = reportSpy.mock.calls[0][0]
    expect(sentReport).toMatchObject({ message: 'Error: agent list is undefined', source: 'error_boundary', route: '/agents/a1/run' })
    expect(sentReport.componentStack).toContain('BrokenScreen')
    expect(await sampleCrashReportsBackend.listCrashReports()).toHaveLength(1)
    window.location.hash = ''
  })
})
