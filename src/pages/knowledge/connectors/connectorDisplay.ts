import type { ConnectorKind, ConnectorView, SyncSchedule } from '@/api/knowledgeTypes'
import { messages } from '@/i18n'

/** The order connector types are offered in. */
export const connectorKinds: ConnectorKind[] = ['website', 'notion', 'google_drive', 'sharepoint', 'api']

/** Two or three letter badge of a connector type (next to PDF, XLS, TXT, WEB). */
export type ConnectorTileType = 'WEB' | 'API' | 'GD' | 'N' | 'SP'

export function connectorTileType(kind: ConnectorKind): ConnectorTileType {
  switch (kind) {
    case 'website':
      return 'WEB'
    case 'api':
      return 'API'
    case 'google_drive':
      return 'GD'
    case 'notion':
      return 'N'
    case 'sharepoint':
      return 'SP'
  }
}

export function connectorLabel(kind: ConnectorKind): { title: string; hint: string } {
  const t = messages().knowledgeConnectors
  switch (kind) {
    case 'website':
      return { title: t.kindWebsite, hint: t.kindWebsiteHint }
    case 'api':
      return { title: t.kindApi, hint: t.kindApiHint }
    case 'google_drive':
      return { title: t.kindGoogleDrive, hint: t.kindGoogleDriveHint }
    case 'notion':
      return { title: t.kindNotion, hint: t.kindNotionHint }
    case 'sharepoint':
      return { title: t.kindSharepoint, hint: t.kindSharepointHint }
  }
}

/** "every: 6h" -> 6, `null` when the interval is not whole hours. */
export function scheduleHours(schedule: SyncSchedule): number | null {
  if (typeof schedule === 'string' || !('every' in schedule)) return null
  const match = schedule.every.match(/^(\d+)([hd])$/)
  if (!match) return null
  const value = Number(match[1])
  return match[2] === 'd' ? value * 24 : value
}

/** "Every 6 hours", "Every day at 06:00", "Only when I click Sync now". */
export function scheduleText(schedule: SyncSchedule): string {
  const t = messages().knowledgeConnectors
  if (schedule === 'manual') return t.scheduleSummaryManual
  if ('every' in schedule) {
    const hours = scheduleHours(schedule)
    return t.scheduleSummaryEvery(hours ? t.scheduleHours(hours) : schedule.every)
  }
  if ('daily' in schedule) return t.scheduleSummaryDaily(schedule.daily)
  return t.scheduleSummaryCron(schedule.cron)
}

/** What a business user should know about the last sync error of a source. */
export function connectorErrorText(kind: string | null): string | null {
  const t = messages().knowledgeConnectors
  switch (kind) {
    case null:
      return null
    case 'auth':
      return t.errorAuth
    case 'forbidden':
      return t.errorForbidden
    case 'not_found':
      return t.errorNotFound
    case 'denied':
      return t.errorDenied
    case 'rate_limited':
      return t.errorRateLimited
    case 'too_large':
      return t.errorTooLarge
    case 'network':
      return t.errorNetwork
    case 'config':
      return t.errorConfig
    case 'busy':
      return t.errorBusy
    case 'items_failed':
      return t.errorItemsFailed
    default:
      return t.errorOther
  }
}

/** "Every 6 hours · next 14:00" for the Updates column of a connector source. */
export function connectorUpdateText(connector: ConnectorView): string {
  const t = messages().knowledgeConnectors
  const parts = [scheduleText(connector.schedule)]
  if (connector.nextSyncAt) {
    const next = new Date(connector.nextSyncAt)
    const isToday = next.toDateString() === new Date().toDateString()
    const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
    parts.push(t.nextSync(isToday ? time : `${next.getDate()}/${next.getMonth() + 1} ${time}`))
  }
  return parts.join(' · ')
}
