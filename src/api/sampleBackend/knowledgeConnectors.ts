import { BackendError } from '../client'
import type {
  ConnectorSignInResult,
  ConnectorSignInSetup,
  ConnectorView,
  KnowledgeSource,
  NewConnectorSource,
  OAuthProvider,
  SyncSchedule,
} from '../knowledgeTypes'
import { sampleKnowledgeInternals } from './knowledge'
import { respondWith } from './sampleResponse'

/**
 * Connector sources for the browser preview and tests: adding one pretends to
 * index it like the sample files, "Sync now" does the same, and signing in to
 * Google or Microsoft succeeds at once with a sample account.
 */

function nextSyncAt(schedule: SyncSchedule): string | null {
  if (schedule === 'manual') return null
  return new Date(Date.now() + 6 * 3_600_000).toISOString()
}

function nameOf(source: NewConnectorSource): string {
  if (source.name.trim()) return source.name.trim()
  const url = source.options.urls instanceof Array ? String(source.options.urls[0] ?? '') : String(source.options.url ?? source.options.site_url ?? '')
  const fromUrl = url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (fromUrl) return fromUrl
  return { website: 'Website', api: 'API', google_drive: 'Google Drive', notion: 'Notion', sharepoint: 'SharePoint' }[source.kind]
}

function authView(source: NewConnectorSource): ConnectorView['auth'] {
  switch (source.auth.type) {
    case 'none':
      return { type: 'none' }
    case 'token':
      return { type: 'token' }
    case 'api_key':
      return { type: 'api_key', header: source.auth.header }
    case 'basic':
      return { type: 'basic', username: source.auth.username }
    case 'oauth':
      return { type: 'oauth', provider: source.kind === 'google_drive' ? 'google' : 'microsoft', clientId: 'sample', hasClientSecret: false }
  }
}

export const sampleKnowledgeConnectorBackend = {
  addConnectorSource: (knowledgeBaseId: string, source: NewConnectorSource): Promise<KnowledgeSource> =>
    respondWith(() => {
      sampleKnowledgeInternals.findKnowledgeBase(knowledgeBaseId)
      if (source.kind === 'website') {
        const urls = source.options.urls
        if (!(urls instanceof Array) || urls.length === 0 || !/^https?:\/\/\S+$/i.test(String(urls[0]))) {
          throw new BackendError('invalid_input', 'invalid input: add at least one web address')
        }
      }
      const id = `src_sample_${sampleKnowledgeInternals.nextId()}`
      const added: KnowledgeSource = {
        id,
        knowledgeBaseId,
        kind: 'url',
        location: `connector:${id}`,
        name: nameOf(source),
        status: 'pending',
        statusMessage: null,
        documentCount: 6,
        failedCount: 0,
        passageCount: 0,
        lastSyncedAt: null,
        createdAt: new Date().toISOString(),
        connector: {
          kind: source.kind,
          options: { ...source.options },
          auth: authView(source),
          schedule: source.schedule,
          nextSyncAt: nextSyncAt(source.schedule),
          accountLabel: source.auth.type === 'oauth' ? 'kamu@contoh.co.id' : null,
          lastErrorKind: null,
        },
      }
      sampleKnowledgeInternals.insertSource(added)
      sampleKnowledgeInternals.pretendToIndex(added)
      return { ...added }
    }),

  setSourceSchedule: (sourceId: string, schedule: SyncSchedule): Promise<KnowledgeSource> =>
    respondWith(() => {
      const source = sampleKnowledgeInternals.findSource(sourceId)
      if (!source.connector) throw new BackendError('not_found', `knowledge connector source ${sourceId} not found`)
      return sampleKnowledgeInternals.replaceSource({ ...source, connector: { ...source.connector, schedule, nextSyncAt: nextSyncAt(schedule) } })
    }),

  syncKnowledgeSource: (sourceId: string): Promise<KnowledgeSource> =>
    respondWith(() => {
      const source = sampleKnowledgeInternals.findSource(sourceId)
      const fixed = source.connector ? { ...source, status: 'indexed' as const, statusMessage: null, failedCount: 0, connector: { ...source.connector, lastErrorKind: null } } : source
      sampleKnowledgeInternals.pretendToIndex(fixed)
      return { ...fixed }
    }),

  connectorSignInSetup: (provider: OAuthProvider): Promise<ConnectorSignInSetup> =>
    respondWith(() => ({
      provider,
      hasBuiltInClient: true,
      redirectUri: 'http://127.0.0.1',
      scopes: provider === 'google' ? 'https://www.googleapis.com/auth/drive.readonly' : 'offline_access User.Read Files.Read.All Sites.Read.All',
    })),

  signInConnector: (provider: OAuthProvider): Promise<ConnectorSignInResult> =>
    respondWith(() => ({ signInId: `signin_sample_${provider}`, accountLabel: 'kamu@contoh.co.id' })),
}
