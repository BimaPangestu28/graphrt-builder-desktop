import { useCallback, useEffect, useId, useState } from 'react'
import { checkCollabServer, getCollabStatus, setCollabServer, signInToCollab, signOutOfCollab } from '@/api/collab'
import type { CollabStatus, ServerCheck, ServerProblem } from '@/api/collabTypes'
import { Button } from '@/components/ui'
import { messages, useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { SettingsGroup } from './SettingRows'

/** The plain words for a failed check. */
export function describeServerProblem(problem: ServerProblem): string {
  const text = messages().collab
  return {
    address: text.problemAddress,
    plain_http: text.problemPlainHttp,
    unreachable: text.problemUnreachable,
    tls: text.problemTls,
    not_collab: text.problemNotCollab,
    http: text.problemHttp,
  }[problem]
}

/** The line under "Check connection". */
export function describeCheck(check: ServerCheck, signedIn: boolean): { tone: 'ok' | 'problem'; text: string } {
  const text = messages().collab
  if (!check.ok) return { tone: 'problem', text: check.problem ? describeServerProblem(check.problem) : text.problemHttp }
  return { tone: 'ok', text: signedIn ? text.checkOk : text.checkOkSignIn }
}

/**
 * Settings > Team server: one address (Graphrt's server by default, or the company's own), a
 * check that says in plain words what is wrong, then sign in. Changing servers keeps local agents.
 */
export function TeamServerSection() {
  const t = useT().collab
  const headingId = useId()
  const addressId = useId()
  const [status, setStatus] = useState<CollabStatus | null>(null)
  const [address, setAddress] = useState('')
  const [check, setCheck] = useState<ServerCheck | null>(null)
  const [busy, setBusy] = useState<'check' | 'save' | 'sign-in' | 'sign-out' | null>(null)
  // Which provider button was pressed, for its "Waiting for the browser" label.
  const [signingInWith, setSigningInWith] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const loaded = await getCollabStatus()
      setStatus(loaded)
      setAddress(loaded.server)
    } catch (loadError) {
      setError(t.couldNot(describeError(loadError)))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Signed out on a saved server: ask it how people sign in, for its provider buttons.
  const savedServer = status?.server ?? null
  const signedIn = status?.signedIn ?? false
  useEffect(() => {
    if (savedServer === null || signedIn) return
    let current = true
    checkCollabServer(savedServer)
      .then((checked) => {
        if (current) setCheck((shown) => shown ?? checked)
      })
      .catch(() => {
        // "Check connection" says what is wrong; the plain Sign in button stays.
      })
    return () => {
      current = false
    }
  }, [savedServer, signedIn])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (actionError) {
      setError(t.couldNot(describeError(actionError)))
    } finally {
      setBusy(null)
    }
  }

  const isSaved = status !== null && address.trim().replace(/\/+$/, '') === status.server
  const signInWithBrowser = check === null || check.signInWithBrowser
  const providers = check?.ok ? check.signInProviders : []

  function signIn(provider?: string) {
    setSigningInWith(provider ?? null)
    void run('sign-in', async () => setStatus(await signInToCollab(provider)))
  }

  return (
    <SettingsGroup headingId={headingId} title={t.title}>
      <p className="m-0 mb-3 text-[13px] leading-normal text-body">{t.intro}</p>
      <label htmlFor={addressId} className="font-medium">
        {t.addressLabel}
      </label>
      <span className="text-[13px] text-body">{t.addressHint}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={addressId}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            setCheck(null)
          }}
          placeholder="https://collab.example.com"
          spellCheck={false}
          className="h-9 min-w-0 flex-[1_1_280px] rounded-[9px] border border-line-strong bg-surface px-2.5 font-mono text-[14px] text-ink outline-none focus:border-brand"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || address.trim() === ''}
          onClick={() => void run('check', async () => setCheck(await checkCollabServer(address)))}
        >
          {busy === 'check' ? t.checking : t.check}
        </Button>
        {!isSaved && (
          <Button
            size="sm"
            disabled={busy !== null || (check !== null && !check.ok)}
            onClick={() =>
              void run('save', async () => {
                const checked = await checkCollabServer(address)
                setCheck(checked)
                if (!checked.ok) return
                const saved = await setCollabServer(checked.server)
                setStatus(saved)
                setAddress(saved.server)
              })
            }
          >
            {busy === 'save' ? t.saving : t.save}
          </Button>
        )}
      </div>
      {status && address.trim() !== status.defaultServer && (
        <button type="button" className="mt-1 w-fit cursor-pointer border-0 bg-transparent p-0 text-[13px] text-brand underline" onClick={() => { setAddress(status.defaultServer); setCheck(null) }}>
          {t.useGraphrt}
        </button>
      )}
      {check && (
        <p role="status" className={`m-0 mt-2 text-[13px] ${check.ok ? 'text-ok-strong' : 'text-danger'}`}>
          {describeCheck(check, status?.signedIn ?? false).text}
        </p>
      )}
      {status && isSaved && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
          {status.signedIn && status.account ? (
            <>
              <span className="flex items-center gap-2 text-[14px]">
                <Avatar name={status.account.name} color={status.account.color} />
                {t.signedInAs(status.account.name)}
              </span>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('sign-out', async () => setStatus(await signOutOfCollab()))}>
                {t.signOut}
              </Button>
            </>
          ) : signInWithBrowser ? (
            <>
              {providers.length === 0 ? (
                <Button size="sm" disabled={busy !== null} onClick={() => signIn()}>
                  {busy === 'sign-in' ? t.signingIn : t.signIn}
                </Button>
              ) : (
                providers.map((provider, index) => (
                  <Button key={provider.id} size="sm" variant={index === 0 ? 'primary' : 'secondary'} disabled={busy !== null} onClick={() => signIn(provider.id)}>
                    {busy === 'sign-in' && signingInWith === provider.id ? t.signingIn : t.signInWith(provider.name)}
                  </Button>
                ))
              )}
              <span className="text-[13px] text-body">{t.signInHint}</span>
            </>
          ) : (
            <span className="text-[13px] text-body">{t.signInWithInvite}</span>
          )}
        </div>
      )}
      <p className="m-0 mt-2 text-[12px] text-muted">{t.localStays}</p>
      {error && (
        <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}

/** A round avatar with the first letter of a name, in the person's color. */
export function Avatar({ name, color, size = 24 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-inverse ring-2 ring-surface"
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.round(size * 0.45) }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
