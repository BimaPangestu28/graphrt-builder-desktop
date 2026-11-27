import { driveIdFromLink, localUtcOffset } from '@/api/knowledgeConnectors'
import { isWebLink } from '@/api/knowledge'
import type { ConnectorAuthInput, ConnectorKind, NewConnectorSource, SyncSchedule } from '@/api/knowledgeTypes'
import { messages } from '@/i18n'

/**
 * What the "Connect a source" wizard collects, and how it becomes the
 * `NewConnectorSource` the backend takes. Kept apart from the components so
 * the rules are tested on their own.
 */

export type WebsiteMode = 'page' | 'crawl' | 'sitemap'
export type ApiPagination = 'none' | 'page' | 'cursor' | 'next_url' | 'link_header'
export type ApiAuthType = 'none' | 'token' | 'api_key' | 'basic'
export type ScheduleMode = 'manual' | 'every' | 'daily' | 'cron'

export interface ConnectorDraft {
  kind: ConnectorKind
  name: string
  website: { url: string; mode: WebsiteMode; depth: number; maxPages: number }
  api: {
    url: string
    method: 'GET' | 'POST'
    itemsPath: string
    textFields: string
    titleField: string
    idField: string
    updatedField: string
    pagination: ApiPagination
    cursorParam: string
    cursorPath: string
    nextPath: string
    authType: ApiAuthType
    secret: string
    header: string
    username: string
  }
  notion: { token: string; links: string }
  drive: { folder: string }
  sharepoint: { where: 'site' | 'onedrive'; site: string; folder: string }
  /** A finished Google or Microsoft sign-in. */
  signIn: { signInId: string; accountLabel: string | null } | null
  schedule: { mode: ScheduleMode; hours: number; time: string; cron: string }
}

export function emptyDraft(kind: ConnectorKind): ConnectorDraft {
  return {
    kind,
    name: '',
    website: { url: '', mode: 'crawl', depth: 2, maxPages: 100 },
    api: {
      url: '',
      method: 'GET',
      itemsPath: '$',
      textFields: '',
      titleField: '',
      idField: '',
      updatedField: '',
      pagination: 'none',
      cursorParam: 'cursor',
      cursorPath: '',
      nextPath: '',
      authType: 'none',
      secret: '',
      header: 'X-Api-Key',
      username: '',
    },
    notion: { token: '', links: '' },
    drive: { folder: '' },
    sharepoint: { where: 'site', site: '', folder: '' },
    signIn: null,
    schedule: { mode: 'every', hours: 6, time: '06:00', cron: '0 */6 * * *' },
  }
}

/** Whether the connector signs in through the browser (Google, Microsoft). */
export function usesBrowserSignIn(kind: ConnectorKind): boolean {
  return kind === 'google_drive' || kind === 'sharepoint'
}

export function scheduleOf(draft: ConnectorDraft, timezone = localUtcOffset()): SyncSchedule {
  const { mode, hours, time, cron } = draft.schedule
  switch (mode) {
    case 'manual':
      return 'manual'
    case 'every':
      return { every: hours % 24 === 0 ? `${hours / 24}d` : `${hours}h` }
    case 'daily':
      return { daily: time, timezone }
    case 'cron':
      return { cron: cron.trim(), timezone }
  }
}

function lines(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function apiAuth(api: ConnectorDraft['api']): ConnectorAuthInput {
  switch (api.authType) {
    case 'none':
      return { type: 'none' }
    case 'token':
      return { type: 'token', token: api.secret }
    case 'api_key':
      return { type: 'api_key', header: api.header, value: api.secret }
    case 'basic':
      return { type: 'basic', username: api.username, password: api.secret }
  }
}

function apiPagination(api: ConnectorDraft['api']): Record<string, unknown> {
  switch (api.pagination) {
    case 'none':
      return { type: 'none' }
    case 'page':
      return { type: 'page' }
    case 'cursor':
      return { type: 'cursor', param: api.cursorParam.trim(), cursor_path: api.cursorPath.trim() }
    case 'next_url':
      return { type: 'next_url', next_path: api.nextPath.trim() }
    case 'link_header':
      return { type: 'link_header' }
  }
}

/** Optional string settings: only the ones filled in. */
function filled(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== ''))
}

/**
 * Checks the settings step. Returns the first problem in words, or null.
 */
export function settingsProblem(draft: ConnectorDraft): string | null {
  const t = messages().knowledgeConnectors
  switch (draft.kind) {
    case 'website':
      return isWebLink(draft.website.url) ? null : messages().knowledge.pasteHttpsLink
    case 'api': {
      if (!isWebLink(draft.api.url)) return messages().knowledge.pasteHttpsLink
      if (draft.api.authType !== 'none' && !draft.api.secret.trim()) return t.fieldRequired(t.authSecret)
      if (draft.api.authType === 'basic' && !draft.api.username.trim()) return t.fieldRequired(t.authUsername)
      if (draft.api.pagination === 'cursor' && !draft.api.cursorPath.trim()) return t.fieldRequired(t.apiCursorPath)
      if (draft.api.pagination === 'next_url' && !draft.api.nextPath.trim()) return t.fieldRequired(t.apiNextPath)
      return null
    }
    case 'notion':
      return draft.notion.token.trim() ? null : t.fieldRequired(t.notionToken)
    case 'google_drive':
      if (!draft.signIn) return t.signInNeeded
      return draft.drive.folder.trim() && !driveIdFromLink(draft.drive.folder) ? t.driveFolderInvalid : null
    case 'sharepoint':
      if (!draft.signIn) return t.signInNeeded
      return draft.sharepoint.where === 'site' && !isWebLink(draft.sharepoint.site) ? messages().knowledge.pasteHttpsLink : null
  }
}

/** The new source the backend takes. Call after {@link settingsProblem} returned null. */
export function toNewSource(draft: ConnectorDraft, timezone = localUtcOffset()): NewConnectorSource {
  const base = { kind: draft.kind, name: draft.name.trim(), schedule: scheduleOf(draft, timezone) }
  switch (draft.kind) {
    case 'website': {
      const { url, mode, depth, maxPages } = draft.website
      return {
        ...base,
        options: { urls: [url.trim()], mode, max_depth: mode === 'crawl' ? depth : 0, max_pages: maxPages },
        auth: { type: 'none' },
      }
    }
    case 'api': {
      const api = draft.api
      const textPaths = lines(api.textFields)
      return {
        ...base,
        options: {
          url: api.url.trim(),
          method: api.method,
          items_path: api.itemsPath.trim() || '$',
          ...(textPaths.length > 0 ? { text_paths: textPaths } : {}),
          ...filled({ title_path: api.titleField, id_path: api.idField, updated_path: api.updatedField }),
          pagination: apiPagination(api),
        },
        auth: apiAuth(api),
      }
    }
    case 'notion': {
      const links = lines(draft.notion.links)
      const databases = links.filter((link) => /[?&]v=|database/i.test(link))
      const pages = links.filter((link) => !databases.includes(link))
      return { ...base, options: { page_ids: pages, database_ids: databases }, auth: { type: 'token', token: draft.notion.token.trim() } }
    }
    case 'google_drive':
      return {
        ...base,
        options: { folder_id: driveIdFromLink(draft.drive.folder) ?? 'root' },
        auth: { type: 'oauth', signInId: draft.signIn?.signInId ?? '' },
      }
    case 'sharepoint': {
      const { where, site, folder } = draft.sharepoint
      return {
        ...base,
        options: where === 'onedrive' ? { onedrive: true, ...filled({ folder_path: folder }) } : { site_url: site.trim(), ...filled({ folder_path: folder }) },
        auth: { type: 'oauth', signInId: draft.signIn?.signInId ?? '' },
      }
    }
  }
}
