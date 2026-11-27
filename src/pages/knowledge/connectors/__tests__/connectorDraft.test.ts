import { driveIdFromLink, localUtcOffset } from '@/api/knowledgeConnectors'
import { emptyDraft, scheduleOf, settingsProblem, toNewSource } from '../connectorDraft'
import { connectorErrorText, scheduleText } from '../connectorDisplay'

describe('connector drafts', () => {
  it('turns a website crawl into graphrt-connect settings', () => {
    const draft = emptyDraft('website')
    expect(settingsProblem(draft)).toBe('Paste a link that starts with https://')
    draft.website.url = 'https://cateringku.example/'
    draft.schedule = { mode: 'daily', hours: 6, time: '06:30', cron: '' }
    expect(settingsProblem(draft)).toBeNull()
    expect(toNewSource(draft, '+07:00')).toEqual({
      kind: 'website',
      name: '',
      options: { urls: ['https://cateringku.example/'], mode: 'crawl', max_depth: 2, max_pages: 100 },
      auth: { type: 'none' },
      schedule: { daily: '06:30', timezone: '+07:00' },
    })
  })

  it('builds API sources with pagination, fields and a key', () => {
    const draft = emptyDraft('api')
    draft.api = {
      ...draft.api,
      url: 'https://api.example.com/articles',
      itemsPath: '$.data[*]',
      textFields: '$.title, $.body',
      updatedField: '$.updated_at',
      pagination: 'cursor',
      cursorPath: '',
      authType: 'api_key',
      secret: 'k-1',
    }
    expect(settingsProblem(draft)).toBe('Where the next cursor is (JSONPath) is needed')
    draft.api.cursorPath = '$.meta.next'
    expect(settingsProblem(draft)).toBeNull()
    const source = toNewSource(draft, 'UTC')
    expect(source.options).toEqual({
      url: 'https://api.example.com/articles',
      method: 'GET',
      items_path: '$.data[*]',
      text_paths: ['$.title', '$.body'],
      updated_path: '$.updated_at',
      pagination: { type: 'cursor', param: 'cursor', cursor_path: '$.meta.next' },
    })
    expect(source.auth).toEqual({ type: 'api_key', header: 'X-Api-Key', value: 'k-1' })
    expect(source.schedule).toEqual({ every: '6h' })
  })

  it('needs a sign-in for Drive and SharePoint, and reads Drive folder links', () => {
    const drive = emptyDraft('google_drive')
    expect(settingsProblem(drive)).toBe('Sign in first')
    drive.signIn = { signInId: 'signin_1', accountLabel: 'a@b.c' }
    drive.drive.folder = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing'
    expect(toNewSource(drive).options).toEqual({ folder_id: '1AbCdEfGhIjKlMn' })
    expect(toNewSource(drive).auth).toEqual({ type: 'oauth', signInId: 'signin_1' })
    drive.drive.folder = 'not a folder'
    expect(settingsProblem(drive)).toBe('This is not a Google Drive folder link')

    const sharepoint = emptyDraft('sharepoint')
    sharepoint.signIn = { signInId: 'signin_2', accountLabel: null }
    sharepoint.sharepoint = { where: 'onedrive', site: '', folder: 'Policies' }
    expect(toNewSource(sharepoint).options).toEqual({ onedrive: true, folder_path: 'Policies' })
    expect(driveIdFromLink('root')).toBe('root')
    expect(driveIdFromLink('https://docs.google.com/document/d/1XyZabcdefghijk/edit')).toBe('1XyZabcdefghijk')
  })

  it('splits Notion links into pages and databases', () => {
    const notion = emptyDraft('notion')
    expect(settingsProblem(notion)).toBe('Integration token is needed')
    notion.notion = { token: ' ntn_x ', links: 'https://www.notion.so/acme/Wiki-1429\nhttps://www.notion.so/acme/abc?v=123' }
    const source = toNewSource(notion)
    expect(source.options).toEqual({ page_ids: ['https://www.notion.so/acme/Wiki-1429'], database_ids: ['https://www.notion.so/acme/abc?v=123'] })
    expect(source.auth).toEqual({ type: 'token', token: 'ntn_x' })
  })

  it('describes schedules and errors in plain words', () => {
    const draft = emptyDraft('website')
    draft.schedule = { mode: 'every', hours: 24, time: '06:00', cron: '' }
    expect(scheduleOf(draft)).toEqual({ every: '1d' })
    expect(scheduleText({ every: '6h' })).toBe('Syncs every 6 hours')
    expect(scheduleText({ every: '1d' })).toBe('Syncs every 24 hours')
    expect(scheduleText('manual')).toBe('Syncs only when you click Sync now')
    expect(connectorErrorText('auth')).toBe('The sign-in expired or was refused. Connect the account again.')
    expect(connectorErrorText('something_new')).toBe('The service answered with an error. The next sync tries again.')
    expect(connectorErrorText(null)).toBeNull()
    expect(localUtcOffset(new Date('2026-11-27T00:00:00Z'))).toMatch(/^[+-]\d{2}:\d{2}$/)
  })
})
