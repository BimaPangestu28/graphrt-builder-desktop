import { useEffect, useState, type ReactNode } from 'react'
import { connectorSignInSetup, signInConnector } from '@/api/knowledgeConnectors'
import type { ConnectorSignInSetup, OAuthProvider } from '@/api/knowledgeTypes'
import { joinClassNames } from '@/components/ui'
import { toError } from '@/lib/errors'
import { useT } from '@/i18n'
import { compactButtonClassNames, fieldControlClassNames, LabeledField } from '../FormControls'
import type { ApiAuthType, ApiPagination, ConnectorDraft, ScheduleMode, WebsiteMode } from './connectorDraft'

type Update = (change: (draft: ConnectorDraft) => ConnectorDraft) => void

const inputClassNames = `${fieldControlClassNames} w-full`

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[12px] leading-normal text-muted">{children}</p>
}

/** Radio choices as a row of wide option cards. */
function OptionCards<Value extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string
  value: Value
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <label
          key={option.value}
          className={joinClassNames(
            'flex cursor-pointer items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] leading-snug',
            option.value === value ? 'border-brand bg-brand-soft text-ink' : 'border-line-strong bg-surface text-ink-2 hover:border-line-heavy',
          )}
        >
          <input type="radio" name={name} checked={option.value === value} onChange={() => onChange(option.value)} className="mt-0.5 accent-brand" />
          {option.label}
        </label>
      ))}
    </div>
  )
}

function WebsiteFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const website = draft.website
  const set = (change: Partial<ConnectorDraft['website']>) => update((current) => ({ ...current, website: { ...current.website, ...change } }))
  return (
    <>
      <LabeledField label={t.websiteAddress}>
        <input type="text" inputMode="url" placeholder="https://your-website.com/" value={website.url} onChange={(event) => set({ url: event.target.value })} className={inputClassNames} />
      </LabeledField>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">{t.websiteHow}</span>
        <OptionCards<WebsiteMode>
          name={t.websiteHow}
          value={website.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'page', label: t.websiteModePage },
            { value: 'crawl', label: t.websiteModeCrawl },
            { value: 'sitemap', label: t.websiteModeSitemap },
          ]}
        />
      </div>
      {website.mode !== 'page' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {website.mode === 'crawl' && (
            <LabeledField label={t.websiteDepth}>
              <select value={website.depth} onChange={(event) => set({ depth: Number(event.target.value) })} className={inputClassNames}>
                {[1, 2, 3].map((depth) => (
                  <option key={depth} value={depth}>
                    {depth}
                  </option>
                ))}
              </select>
            </LabeledField>
          )}
          <LabeledField label={t.websiteMaxPages}>
            <select value={website.maxPages} onChange={(event) => set({ maxPages: Number(event.target.value) })} className={inputClassNames}>
              {[25, 100, 250, 500, 1000].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </LabeledField>
        </div>
      )}
      <Note>{t.websiteRobotsNote}</Note>
    </>
  )
}

function ApiFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const api = draft.api
  const set = (change: Partial<ConnectorDraft['api']>) => update((current) => ({ ...current, api: { ...current.api, ...change } }))
  const text = (label: string, key: 'itemsPath' | 'textFields' | 'titleField' | 'idField' | 'updatedField' | 'cursorParam' | 'cursorPath' | 'nextPath', placeholder: string) => (
    <LabeledField label={label}>
      <input type="text" placeholder={placeholder} value={api[key]} onChange={(event) => set({ [key]: event.target.value })} className={inputClassNames} />
    </LabeledField>
  )
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
        <LabeledField label={t.apiAddress}>
          <input type="text" inputMode="url" placeholder="https://api.your-app.com/v1/articles" value={api.url} onChange={(event) => set({ url: event.target.value })} className={inputClassNames} />
        </LabeledField>
        <LabeledField label={t.apiMethod}>
          <select value={api.method} onChange={(event) => set({ method: event.target.value === 'POST' ? 'POST' : 'GET' })} className={inputClassNames}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </LabeledField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text(t.apiItemsPath, 'itemsPath', '$.data[*]')}
        {text(t.apiTextFields, 'textFields', '$.title, $.body')}
        {text(t.apiTitleField, 'titleField', '$.title')}
        {text(t.apiIdField, 'idField', '$.id')}
        {text(t.apiUpdatedField, 'updatedField', '$.updated_at')}
        <LabeledField label={t.apiPagination}>
          <select value={api.pagination} onChange={(event) => set({ pagination: event.target.value as ApiPagination })} className={inputClassNames}>
            <option value="none">{t.apiPaginationNone}</option>
            <option value="page">{t.apiPaginationPage}</option>
            <option value="cursor">{t.apiPaginationCursor}</option>
            <option value="next_url">{t.apiPaginationNextUrl}</option>
            <option value="link_header">{t.apiPaginationLink}</option>
          </select>
        </LabeledField>
        {api.pagination === 'cursor' && text(t.apiCursorParam, 'cursorParam', 'cursor')}
        {api.pagination === 'cursor' && text(t.apiCursorPath, 'cursorPath', '$.meta.next_cursor')}
        {api.pagination === 'next_url' && text(t.apiNextPath, 'nextPath', '$.links.next')}
      </div>
      <LabeledField label={t.authTitle}>
        <select value={api.authType} onChange={(event) => set({ authType: event.target.value as ApiAuthType })} className={inputClassNames}>
          <option value="none">{t.authNone}</option>
          <option value="token">{t.authToken}</option>
          <option value="api_key">{t.authApiKey}</option>
          <option value="basic">{t.authBasic}</option>
        </select>
      </LabeledField>
      {api.authType !== 'none' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {api.authType === 'api_key' && (
            <LabeledField label={t.authHeaderName}>
              <input type="text" value={api.header} onChange={(event) => set({ header: event.target.value })} className={inputClassNames} />
            </LabeledField>
          )}
          {api.authType === 'basic' && (
            <LabeledField label={t.authUsername}>
              <input type="text" value={api.username} onChange={(event) => set({ username: event.target.value })} className={inputClassNames} />
            </LabeledField>
          )}
          <LabeledField label={api.authType === 'basic' ? t.authPassword : t.authSecret}>
            <input type="password" autoComplete="off" value={api.secret} onChange={(event) => set({ secret: event.target.value })} className={inputClassNames} />
          </LabeledField>
        </div>
      )}
      {api.authType !== 'none' && <Note>{t.secretStoredNote}</Note>}
    </>
  )
}

function NotionFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const set = (change: Partial<ConnectorDraft['notion']>) => update((current) => ({ ...current, notion: { ...current.notion, ...change } }))
  return (
    <>
      <LabeledField label={t.notionToken}>
        <input type="password" autoComplete="off" placeholder="ntn_…" value={draft.notion.token} onChange={(event) => set({ token: event.target.value })} className={inputClassNames} />
      </LabeledField>
      <Note>{t.notionTokenHint}</Note>
      <LabeledField label={t.notionPages}>
        <textarea rows={3} placeholder="https://www.notion.so/…" value={draft.notion.links} onChange={(event) => set({ links: event.target.value })} className={`${inputClassNames} h-auto py-2`} />
      </LabeledField>
      <Note>{t.secretStoredNote}</Note>
    </>
  )
}

/** "Sign in with Google / Microsoft", with fields for an own client id when the app has none. */
function BrowserSignIn({ provider, draft, update }: { provider: OAuthProvider; draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const [setup, setSetup] = useState<ConnectorSignInSetup | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let isCurrent = true
    connectorSignInSetup(provider)
      .then((loaded) => isCurrent && setSetup(loaded))
      .catch((loadError: unknown) => isCurrent && setProblem(toError(loadError).message))
    return () => {
      isCurrent = false
    }
  }, [provider])
  const needsOwnClient = setup !== null && !setup.hasBuiltInClient
  const signIn = async () => {
    setProblem(null)
    setIsSigningIn(true)
    try {
      const result = await signInConnector(provider, needsOwnClient ? { clientId, clientSecret } : undefined)
      update((current) => ({ ...current, signIn: result }))
    } catch (signInError) {
      setProblem(toError(signInError).message)
    } finally {
      setIsSigningIn(false)
    }
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-subtle p-3.5">
      {needsOwnClient && (
        <>
          <span className="text-[13px] font-medium">{t.ownClientTitle}</span>
          <Note>{t.ownClientHint(setup.redirectUri)}</Note>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledField label={t.clientId}>
              <input type="text" value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClassNames} />
            </LabeledField>
            {provider === 'google' && (
              <LabeledField label={t.clientSecret}>
                <input type="password" autoComplete="off" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className={inputClassNames} />
              </LabeledField>
            )}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isSigningIn || (needsOwnClient && !clientId.trim())}
          onClick={() => void signIn()}
          className={compactButtonClassNames(draft.signIn ? 'secondary' : 'primary')}
        >
          {provider === 'google' ? t.signInGoogle : t.signInMicrosoft}
        </button>
        <span className="text-[13px] text-ink-2">
          {isSigningIn ? t.signingIn : draft.signIn ? (draft.signIn.accountLabel ? t.signedInAs(draft.signIn.accountLabel) : t.signedIn) : ''}
        </span>
      </div>
      <Note>{t.readOnlyNote}</Note>
      {problem && <span className="text-[12px] text-danger">{problem}</span>}
    </div>
  )
}

function DriveFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  return (
    <>
      <BrowserSignIn provider="google" draft={draft} update={update} />
      <LabeledField label={t.driveFolder}>
        <input
          type="text"
          inputMode="url"
          placeholder="https://drive.google.com/drive/folders/…"
          value={draft.drive.folder}
          onChange={(event) => update((current) => ({ ...current, drive: { folder: event.target.value } }))}
          className={inputClassNames}
        />
      </LabeledField>
      <Note>{t.driveFolderHint}</Note>
    </>
  )
}

function SharepointFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const sharepoint = draft.sharepoint
  const set = (change: Partial<ConnectorDraft['sharepoint']>) => update((current) => ({ ...current, sharepoint: { ...current.sharepoint, ...change } }))
  return (
    <>
      <BrowserSignIn provider="microsoft" draft={draft} update={update} />
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">{t.sharepointWhere}</span>
        <OptionCards<'site' | 'onedrive'>
          name={t.sharepointWhere}
          value={sharepoint.where}
          onChange={(where) => set({ where })}
          options={[
            { value: 'site', label: t.sharepointSite },
            { value: 'onedrive', label: t.sharepointOnedrive },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sharepoint.where === 'site' && (
          <LabeledField label={t.sharepointSiteAddress}>
            <input type="text" inputMode="url" placeholder="https://company.sharepoint.com/sites/HR" value={sharepoint.site} onChange={(event) => set({ site: event.target.value })} className={inputClassNames} />
          </LabeledField>
        )}
        <LabeledField label={t.sharepointFolder}>
          <input type="text" placeholder="Policies/2026" value={sharepoint.folder} onChange={(event) => set({ folder: event.target.value })} className={inputClassNames} />
        </LabeledField>
      </div>
    </>
  )
}

/** The settings step of the wizard for the draft's connector type. */
export function ConnectorFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  return (
    <div className="flex flex-col gap-3.5">
      {draft.kind === 'website' && <WebsiteFields draft={draft} update={update} />}
      {draft.kind === 'api' && <ApiFields draft={draft} update={update} />}
      {draft.kind === 'notion' && <NotionFields draft={draft} update={update} />}
      {draft.kind === 'google_drive' && <DriveFields draft={draft} update={update} />}
      {draft.kind === 'sharepoint' && <SharepointFields draft={draft} update={update} />}
      <LabeledField label={t.sourceName}>
        <input type="text" placeholder={t.sourceNamePlaceholder} value={draft.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} className={inputClassNames} />
      </LabeledField>
    </div>
  )
}

/** The schedule step: manual, every few hours, daily at a time, or cron. */
export function ScheduleFields({ draft, update }: { draft: ConnectorDraft; update: Update }) {
  const t = useT().knowledgeConnectors
  const schedule = draft.schedule
  const set = (change: Partial<ConnectorDraft['schedule']>) => update((current) => ({ ...current, schedule: { ...current.schedule, ...change } }))
  const option = (mode: ScheduleMode, label: string, control?: ReactNode) => (
    <label
      className={joinClassNames(
        'flex min-h-[52px] cursor-pointer flex-wrap items-center gap-3 rounded-[12px] border px-3.5 py-2.5 text-[14px]',
        schedule.mode === mode ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:border-line-heavy',
      )}
    >
      <input type="radio" name="schedule" checked={schedule.mode === mode} onChange={() => set({ mode })} className="accent-brand" />
      <span className="font-medium">{label}</span>
      {schedule.mode === mode && control}
    </label>
  )
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[14px] font-semibold">{t.scheduleTitle}</span>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {option(
          'every',
          t.scheduleEvery,
          <select aria-label={t.scheduleEvery} value={schedule.hours} onChange={(event) => set({ hours: Number(event.target.value) })} className={`${fieldControlClassNames} h-9`}>
            {[1, 3, 6, 12, 24].map((hours) => (
              <option key={hours} value={hours}>
                {t.scheduleHours(hours)}
              </option>
            ))}
          </select>,
        )}
        {option(
          'daily',
          t.scheduleDaily,
          <input aria-label={t.scheduleDaily} type="time" value={schedule.time} onChange={(event) => set({ time: event.target.value })} className={`${fieldControlClassNames} h-9`} />,
        )}
        {option('manual', t.scheduleManual)}
        {option(
          'cron',
          t.scheduleCron,
          <input aria-label={t.scheduleCron} type="text" value={schedule.cron} onChange={(event) => set({ cron: event.target.value })} className={`${fieldControlClassNames} h-9 w-44 font-mono text-[13px]`} />,
        )}
      </div>
      {schedule.mode === 'cron' && <Note>{t.scheduleCronHint}</Note>}
      <Note>{t.incrementalNote}</Note>
    </div>
  )
}
