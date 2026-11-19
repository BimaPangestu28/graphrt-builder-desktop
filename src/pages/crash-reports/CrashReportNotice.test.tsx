import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CrashNotice } from '@/api/crashReportTypes'
import type { CommandHandlers } from '@/test/desktopBackend'
import { CrashReportNotice } from './CrashReportNotice'

/** The notice on the launch after a crash, against a fake desktop backend. */

const fakeBackend = vi.hoisted(() => ({ handlers: {} as CommandHandlers }))
vi.mock('@/api/client', async (importOriginal) => {
  const { createDesktopClient } = await import('@/test/desktopBackend')
  return createDesktopClient(await importOriginal(), fakeBackend)
})

const reportId = '20261118T101500000Z-1a2b3c4d'

function createNotice(offersSharing: boolean): CrashNotice {
  return { report: { id: reportId, kind: 'panic', createdAt: '2026-11-18T10:15:00Z', message: 'index out of bounds' }, offersSharing }
}

function answerWithNotice(notice: CrashNotice | null, calls: string[]) {
  fakeBackend.handlers = {
    get_crash_notice: () => notice,
    get_crash_report: ({ reportId: requestedId }) => {
      calls.push(`get_crash_report ${String(requestedId)}`)
      return '{\n  "message": "index out of bounds"\n}'
    },
    dismiss_crash_notice: ({ reportId: dismissedId }) => {
      calls.push(`dismiss_crash_notice ${String(dismissedId)}`)
      return null
    },
    open_crash_report_issue: ({ reportId: openedId }) => {
      calls.push(`open_crash_report_issue ${String(openedId)}`)
      return null
    },
  }
}

describe('CrashReportNotice', () => {
  it('shows nothing when there was no crash', async () => {
    const calls: string[] = []
    answerWithNotice(null, calls)
    const { container } = render(<CrashReportNotice />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('says graphrt closed unexpectedly and shows the report on View', async () => {
    const calls: string[] = []
    answerWithNotice(createNotice(false), calls)
    render(<CrashReportNotice />)
    expect(await screen.findByText('graphrt closed unexpectedly. A crash report was saved on this computer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open a GitHub issue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(await screen.findByRole('dialog', { name: 'Crash report' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Crash report contents')).toHaveTextContent('"message": "index out of bounds"')
    expect(calls).toContain(`get_crash_report ${reportId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Close the crash report' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('remembers Dismiss and hides the notice', async () => {
    const calls: string[] = []
    answerWithNotice(createNotice(false), calls)
    render(<CrashReportNotice />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/closed unexpectedly/)).not.toBeInTheDocument()
    await waitFor(() => expect(calls).toContain(`dismiss_crash_notice ${reportId}`))
  })

  it('offers a GitHub issue only when the user opted in', async () => {
    const calls: string[] = []
    answerWithNotice(createNotice(true), calls)
    render(<CrashReportNotice />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open a GitHub issue' }))
    await waitFor(() => expect(calls).toContain(`open_crash_report_issue ${reportId}`))
    expect(screen.getByText(/closed unexpectedly/)).toBeInTheDocument()
  })
})
