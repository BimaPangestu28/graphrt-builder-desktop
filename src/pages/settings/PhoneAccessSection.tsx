import { useCallback, useEffect, useId, useState } from 'react'
import { getPhoneAccessStatus, listPhoneActivity, onPhoneAccessChanged, savePhoneAccess } from '@/api/phoneAccess'
import type { PhoneAccessSettings, PhoneAccessStatus, PhoneActivity, PhoneReach } from '@/api/phoneAccessTypes'
import { Badge, Button } from '@/components/ui'
import { messages, useT } from '@/i18n'
import { describeTimeAgo, plainErrorMessage } from '../deploy/deployDisplay'
import { isoFromMs } from '../deploy/onlineFeatures'
import { PairedPhones } from '../deploy/PairedPhones'
import { SettingsGroup, ToggleRow } from './SettingRows'

type ReachKind = PhoneReach['kind']

const reachKinds: readonly ReachKind[] = ['lan', 'tailscale', 'tunnel']

/** One line of the activity list. */
function describeActivity(entry: PhoneActivity): string {
  const text = messages().phoneAccess
  const name = entry.deviceName ?? text.aPhone
  switch (entry.kind) {
    case 'paired':
      return text.activityPaired(name)
    case 'removed':
      return text.activityRemoved(name)
    case 'unpaired_itself':
      return text.activityUnpairedItself(name)
    case 'answered':
      return text.activityAnswered(name, entry.agentName ?? text.anAgent)
    case 'pairing_refused':
      return text.activityPairingRefused
  }
}

function reachTitle(kind: ReachKind): string {
  const text = messages().phoneAccess
  return { lan: text.reachLanTitle, tailscale: text.reachTailscaleTitle, tunnel: text.reachTunnelTitle }[kind]
}

function reachDetail(kind: ReachKind, port: number): string {
  const text = messages().phoneAccess
  return { lan: text.reachLanDetail, tailscale: text.reachTailscaleDetail, tunnel: text.reachTunnelDetail(port) }[kind]
}

/** What Tailscale offers, under its choice. */
function TailscaleLine({ status }: { status: PhoneAccessStatus }) {
  const text = useT().phoneAccess
  const { tailscale } = status
  if (!tailscale.installed) return <span className="text-[13px] text-body">{text.tailscaleNotInstalled}</span>
  if (!tailscale.running) return <span className="text-[13px] text-amber-strong">{text.tailscaleNotRunning}</span>
  return (
    <span className="flex flex-col gap-0.5 text-[13px] text-body">
      <span>{text.tailscaleConnected(tailscale.dnsName ?? tailscale.address ?? '')}</span>
      <span className={tailscale.httpsCertificates ? 'text-ok-strong' : 'text-amber-strong'}>{tailscale.httpsCertificates ? text.tailscaleHttpsOn : text.tailscaleHttpsOff}</span>
    </span>
  )
}

/** Where phones connect, once it serves. */
function ServingAddress({ status }: { status: PhoneAccessStatus }) {
  const text = useT().phoneAccess
  const [isCopied, setIsCopied] = useState(false)
  if (!status.address) return null
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-body">{text.phonesOpen}</span>
        <code className="break-all font-mono text-[14px] text-ink">{status.address}</code>
        <Badge tone={status.secure ? 'ok' : 'amber'}>{status.secure ? text.secure : text.notSecure}</Badge>
      </span>
      {status.notice && <span className="text-[13px] leading-normal text-body">{status.notice}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        onClick={() => {
          void navigator.clipboard?.writeText(status.address ?? '')
          setIsCopied(true)
        }}
      >
        {isCopied ? text.copied : text.copyAddress}
      </Button>
    </div>
  )
}

/**
 * Settings > Phone access: the agents of this computer on the person's phone. Off until turned
 * on; then the person chooses where the phone is (same Wi-Fi, Tailscale, their own tunnel),
 * pairs phones with a QR code (the same list as for online agents) and sees what phones did.
 */
export function PhoneAccessSection() {
  const text = useT().phoneAccess
  const tunnelInputId = useId()
  const [status, setStatus] = useState<PhoneAccessStatus | null>(null)
  const [activity, setActivity] = useState<PhoneActivity[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [tunnelUrl, setTunnelUrl] = useState('')

  const load = useCallback(async () => {
    try {
      const [loaded, entries] = await Promise.all([getPhoneAccessStatus(), listPhoneActivity(10)])
      setStatus(loaded)
      setActivity(entries)
      setLoadError(null)
      if (loaded.settings.reach.kind === 'tunnel') setTunnelUrl(loaded.settings.reach.publicUrl)
    } catch (error) {
      setLoadError(plainErrorMessage(error))
    }
  }, [])

  useEffect(() => {
    void load()
    let stop: (() => void) | null = null
    let isActive = true
    void onPhoneAccessChanged(() => void load()).then((unsubscribe) => {
      if (isActive) stop = unsubscribe
      else unsubscribe()
    })
    return () => {
      isActive = false
      stop?.()
    }
  }, [load])

  async function save(settings: PhoneAccessSettings) {
    setIsSaving(true)
    setSaveError(null)
    try {
      setStatus(await savePhoneAccess(settings))
      setActivity(await listPhoneActivity(10))
    } catch (error) {
      setSaveError(plainErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  if (!status) {
    return (
      <SettingsGroup headingId="settings-phone-heading" title={text.title}>
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
            {text.couldNotLoad(loadError)}
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              {text.tryAgain}
            </Button>
          </div>
        ) : (
          <p role="status" className="m-0 text-[13px] text-muted">
            {messages().settings.loading}
          </p>
        )}
      </SettingsGroup>
    )
  }

  const { settings } = status
  const chooseReach = (kind: ReachKind) => {
    if (kind === 'tunnel') {
      // Saved once the address is entered.
      setStatus({ ...status, settings: { ...settings, reach: { kind: 'tunnel', publicUrl: tunnelUrl } } })
      return
    }
    void save({ ...settings, reach: { kind } })
  }

  return (
    <SettingsGroup headingId="settings-phone-heading" title={text.title}>
      <p className="m-0 mb-1 text-[14px] leading-normal text-body">{text.intro}</p>
      <ToggleRow title={text.toggleTitle} description={text.toggleHint} isChecked={settings.enabled} onToggle={(isChecked) => void save({ ...settings, enabled: isChecked })} />
      {settings.enabled && (
        <div className="flex flex-col gap-4 pt-3.5">
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={isSaving}>
            <legend className="mb-2 p-0 font-medium">{text.whereTitle}</legend>
            {reachKinds.map((kind) => (
              <label key={kind} className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line px-3 py-2.5 has-[:checked]:border-brand-line has-[:checked]:bg-brand-tint">
                <input type="radio" name="phone-reach" className="mt-1 accent-ink" checked={settings.reach.kind === kind} onChange={() => chooseReach(kind)} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{reachTitle(kind)}</span>
                  <span className="text-[13px] leading-normal text-body">{reachDetail(kind, settings.port)}</span>
                  {kind === 'tailscale' && settings.reach.kind === 'tailscale' && <TailscaleLine status={status} />}
                </span>
              </label>
            ))}
          </fieldset>
          {settings.reach.kind === 'tunnel' && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void save({ ...settings, reach: { kind: 'tunnel', publicUrl: tunnelUrl } })
              }}
            >
              <label htmlFor={tunnelInputId} className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 text-[13px] text-ink-2">
                {text.tunnelUrlLabel}
                <input id={tunnelInputId} type="url" value={tunnelUrl} onChange={(event) => setTunnelUrl(event.target.value)} placeholder={text.tunnelUrlPlaceholder} className="box-border h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink" />
              </label>
              <Button size="sm" type="submit" disabled={isSaving || !tunnelUrl.trim()}>
                {isSaving ? text.saving : text.save}
              </Button>
            </form>
          )}
          {status.serving ? <ServingAddress status={status} /> : status.problem && <p role="status" className="m-0 text-[13px] leading-normal text-amber-strong">{status.problem}</p>}
          {isSaving && !status.serving && <p className="m-0 text-[13px] text-muted">{text.starting}</p>}
          {status.serving && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] leading-normal text-body">{text.pairHint}</span>
              <PairedPhones target={{ kind: 'computer' }} codeNote={text.codeNote} />
            </div>
          )}
        </div>
      )}
      {saveError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {saveError}
        </p>
      )}
      {(settings.enabled || activity.length > 0) && (
        <div className="flex flex-col gap-1.5 pt-4">
          <span className="text-[13px] font-semibold text-ink-2">{text.activityTitle}</span>
          {activity.length === 0 ? (
            <span className="text-[13px] text-body">{text.noActivity}</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {activity.map((entry, index) => (
                <li key={`${entry.atMs}-${index}`} className="flex flex-wrap justify-between gap-2 text-[13px]">
                  <span className="text-ink">{describeActivity(entry)}</span>
                  <span className="text-body">{describeTimeAgo(isoFromMs(entry.atMs))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}
