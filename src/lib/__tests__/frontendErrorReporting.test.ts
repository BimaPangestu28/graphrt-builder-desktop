import { waitFor } from '@testing-library/react'
import { resetSampleCrashReports, sampleCrashReportsBackend } from '@/api/sampleBackend/crashReports'
import { installFrontendErrorReporting, resetFrontendErrorReporting, routeFromHash, sendFrontendErrorReport } from '../frontendErrorReporting'

describe('frontend error reporting', () => {
  beforeEach(() => {
    resetSampleCrashReports()
    resetFrontendErrorReporting()
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps only the path of the route', () => {
    expect(routeFromHash('#/agents/a1/run?input=secret')).toBe('/agents/a1/run')
    expect(routeFromHash('#/home')).toBe('/home')
    expect(routeFromHash('')).toBe('/')
  })

  it('reports uncaught errors and unhandled rejections', async () => {
    const reportSpy = vi.spyOn(sampleCrashReportsBackend, 'reportFrontendError')
    const removeListeners = installFrontendErrorReporting(window)
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('x is not a function'), message: 'x is not a function' }))
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('network down') })
    window.dispatchEvent(rejection)
    removeListeners()
    await waitFor(() => expect(reportSpy).toHaveBeenCalledTimes(2))
    expect(reportSpy.mock.calls[0][0]).toMatchObject({ message: 'TypeError: x is not a function', source: 'window_error' })
    expect(reportSpy.mock.calls[1][0]).toMatchObject({ message: 'Error: network down', source: 'unhandled_rejection' })
  })

  it('reports the same message once and never sends thrown objects', async () => {
    const reportSpy = vi.spyOn(sampleCrashReportsBackend, 'reportFrontendError')
    sendFrontendErrorReport(new Error('same'), 'window_error')
    sendFrontendErrorReport(new Error('same'), 'window_error')
    sendFrontendErrorReport({ password: 'hunter2' }, 'unhandled_rejection')
    await waitFor(() => expect(reportSpy).toHaveBeenCalledTimes(2))
    expect(reportSpy.mock.calls[1][0].message).toBe('Non-error value thrown (object)')
    expect(JSON.stringify(reportSpy.mock.calls)).not.toContain('hunter2')
  })

  it('stops after ten reports per session', async () => {
    const reportSpy = vi.spyOn(sampleCrashReportsBackend, 'reportFrontendError')
    for (let index = 0; index < 15; index += 1) sendFrontendErrorReport(new Error(`error ${index}`), 'window_error')
    await waitFor(() => expect(reportSpy).toHaveBeenCalledTimes(10))
  })

  it('never throws when saving the report fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(sampleCrashReportsBackend, 'reportFrontendError').mockRejectedValueOnce(new Error('disk full'))
    expect(() => sendFrontendErrorReport(new Error('boom'), 'window_error')).not.toThrow()
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
  })
})
