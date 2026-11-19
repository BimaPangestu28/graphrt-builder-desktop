import { BackendError } from '../client'
import type { CrashNotice, CrashReportExportSummary, CrashReportSummary, FrontendErrorReport } from '../crashReportTypes'
import { respondWith } from './sampleResponse'

/**
 * Sample crash reports for the browser preview and tests, kept in module memory. The
 * browser preview has no backend to crash, so it starts empty; reported frontend errors
 * are added the way the desktop app would add them.
 */

interface SampleCrashReport {
  summary: CrashReportSummary
  json: string
}

let storedReports: SampleCrashReport[] = []
let offersSharing = false
let dismissedThrough: string | null = null

function buildSampleReport(error: FrontendErrorReport): SampleCrashReport {
  const createdAt = new Date().toISOString()
  const randomSuffix = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  const id = `${createdAt.replace(/[-:.]/g, '')}-${randomSuffix}`
  const summary: CrashReportSummary = { id, kind: 'frontend', createdAt, message: error.message.split('\n')[0] }
  const report = { schemaVersion: 1, id, kind: 'frontend', createdAt, appVersion: '0.1.0', os: 'browser', arch: 'preview', ...error }
  return { summary, json: JSON.stringify(report, null, 2) }
}

function findReport(reportId: string): SampleCrashReport {
  const report = storedReports.find((candidate) => candidate.summary.id === reportId)
  if (!report) throw new BackendError('not_found', `crash report ${reportId} not found`)
  return report
}

function findNotice(): CrashNotice | null {
  const unseenPanic = storedReports.find(
    (report) => report.summary.kind === 'panic' && (dismissedThrough === null || report.summary.id > dismissedThrough),
  )
  return unseenPanic ? { report: unseenPanic.summary, offersSharing } : null
}

function exportSampleReports(path: string): CrashReportExportSummary {
  if (!path.endsWith('.json')) throw new BackendError('invalid_input', 'invalid input: export to an absolute path ending in .json')
  return { path, reportCount: storedReports.length }
}

function deleteSampleReports(): number {
  const deletedCount = storedReports.length
  storedReports = []
  return deletedCount
}

function openSampleIssue(reportId: string): void {
  findReport(reportId)
  if (!offersSharing) throw new BackendError('invalid_input', 'invalid input: turn on "offer to share crash reports" in Settings first')
}

export const sampleCrashReportsBackend = {
  listCrashReports: (): Promise<CrashReportSummary[]> => respondWith(() => storedReports.map((report) => report.summary)),
  getCrashReport: (reportId: string): Promise<string> => respondWith(() => findReport(reportId).json),
  deleteAllCrashReports: (): Promise<number> => respondWith(deleteSampleReports),
  exportCrashReports: (path: string): Promise<CrashReportExportSummary> => respondWith(() => exportSampleReports(path)),
  reportFrontendError: (error: FrontendErrorReport): Promise<void> =>
    respondWith(() => {
      storedReports = [buildSampleReport(error), ...storedReports]
    }),
  getCrashNotice: (): Promise<CrashNotice | null> => respondWith(findNotice),
  dismissCrashNotice: (reportId: string): Promise<void> =>
    respondWith(() => {
      dismissedThrough = reportId
    }),
  getCrashReportSharing: (): Promise<boolean> => respondWith(() => offersSharing),
  setCrashReportSharing: (shouldOffer: boolean): Promise<boolean> =>
    respondWith(() => {
      offersSharing = shouldOffer
      return offersSharing
    }),
  openCrashReportIssue: (reportId: string): Promise<void> => respondWith(() => openSampleIssue(reportId)),
}

/** Forgets every sample report, the opt-in and the dismissed notice (use in test `beforeEach`). */
export function resetSampleCrashReports(): void {
  storedReports = []
  offersSharing = false
  dismissedThrough = null
}
