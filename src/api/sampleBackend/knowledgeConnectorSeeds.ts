import type { KnowledgeSource } from '../knowledgeTypes'

/**
 * Connector sources of the sample "Catering menu and prices" knowledge base, so the
 * browser preview shows synced sources next to files: a crawled web site, a Notion
 * wiki and a Google Drive folder whose sign-in expired.
 */
export function seedConnectorSources(knowledgeBaseId: string, lastSyncedAt: string): KnowledgeSource[] {
  const hoursLater = (hours: number) => new Date(new Date(lastSyncedAt).getTime() + hours * 3_600_000).toISOString()
  const base = {
    knowledgeBaseId,
    kind: 'url' as const,
    failedCount: 0,
    lastSyncedAt,
    createdAt: '2026-10-01T02:00:00Z',
  }
  return [
    {
      ...base,
      id: 'notion-wiki',
      name: 'Wiki tim dapur',
      location: 'connector:notion-wiki',
      status: 'indexed',
      statusMessage: null,
      documentCount: 18,
      passageCount: 142,
      connector: {
        kind: 'notion',
        options: { page_ids: [] },
        auth: { type: 'token' },
        schedule: { every: '6h' },
        nextSyncAt: hoursLater(6),
        accountLabel: null,
        lastErrorKind: null,
      },
    },
    {
      ...base,
      id: 'site-crawl',
      name: 'cateringku.example',
      location: 'connector:site-crawl',
      status: 'indexed',
      statusMessage: null,
      documentCount: 24,
      passageCount: 210,
      connector: {
        kind: 'website',
        options: { urls: ['https://cateringku.example/'], mode: 'crawl', max_depth: 2, max_pages: 100 },
        auth: { type: 'none' },
        schedule: { daily: '06:00', timezone: '+07:00' },
        nextSyncAt: hoursLater(17),
        accountLabel: null,
        lastErrorKind: null,
      },
    },
    {
      ...base,
      id: 'drive-menu',
      name: 'Folder Menu (Google Drive)',
      location: 'connector:drive-menu',
      status: 'failed',
      statusMessage: 'Google Drive did not accept the sign-in; connect the account again',
      failedCount: 1,
      documentCount: 9,
      passageCount: 77,
      connector: {
        kind: 'google_drive',
        options: { folder_id: '1AbCdEfGhIjKlMnOp' },
        auth: { type: 'oauth', provider: 'google', clientId: 'sample', hasClientSecret: true },
        schedule: { every: '1d' },
        nextSyncAt: hoursLater(24),
        accountLabel: 'dapur@cateringku.example',
        lastErrorKind: 'auth',
      },
    },
  ]
}
