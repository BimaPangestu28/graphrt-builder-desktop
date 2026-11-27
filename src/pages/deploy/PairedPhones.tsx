import { useCallback, useEffect, useId, useState } from 'react'
import { listPairedDevices, pairDevice, revokePairedDevice, showDevicePairing } from '@/api/deploy'
import type { DevicePairing, OnlineTarget, PairedDevice } from '@/api/deployTypes'
import { Button } from '@/components/ui'
import { messages } from '@/i18n'
import { describeTimeAgo, plainErrorMessage } from './deployDisplay'
import { isoFromMs } from './onlineFeatures'
import { QrCode } from './QrCode'

/** The code of one phone: shown because the person just paired it or asked to see it. */
function PairingCode({ pairing, onHide }: { pairing: DevicePairing; onHide: () => void }) {
  const text = messages().deploy.sharing
  const [isCopied, setIsCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-xl border border-brand-line bg-brand-tint p-4">
      <QrCode text={pairing.link} label={text.qrLabel} />
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        <span className="font-semibold">{text.scanWith(pairing.deviceName)}</span>
        <span className="text-[13px] leading-normal text-body">{text.scanHint}</span>
        <span className="text-[13px] leading-normal text-amber-strong">{text.codeIsAKey}</span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onHide}>
            {text.hideCode}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(pairing.link)
              setIsCopied(true)
            }}
          >
            {isCopied ? text.copied : text.copyPairingLink}
          </Button>
        </span>
      </div>
    </div>
  )
}

/**
 * The phones paired with an online agent or a connected server: pair a new one (its code is
 * shown once it exists and hidden again on request), show a kept code again, and remove a
 * phone after a confirmation. A code is the phone's key, so it is only ever on screen because
 * the person asked for it.
 */
export function PairedPhones({ target }: { target: OnlineTarget }) {
  const text = messages().deploy.sharing
  const nameId = useId()
  const [devices, setDevices] = useState<PairedDevice[] | null>(null)
  const [isNaming, setIsNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [shownCode, setShownCode] = useState<DevicePairing | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const targetKey = target.kind === 'agent' ? `agent:${target.agentId}` : `server:${target.serverId}`

  const load = useCallback(async () => {
    try {
      setDevices(await listPairedDevices(target))
    } catch (error) {
      setDevices([])
      setErrorMessage(plainErrorMessage(error))
    }
    // Keyed by the target's identity: a new object for the same target must not reload.
  }, [targetKey])

  useEffect(() => {
    setShownCode(null)
    void load()
  }, [load])

  async function act(label: string, action: () => Promise<void>) {
    setBusy(label)
    setErrorMessage(null)
    try {
      await action()
    } catch (error) {
      setErrorMessage(plainErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const pair = () =>
    act('pair', async () => {
      setShownCode(await pairDevice(target, name))
      setIsNaming(false)
      setName('')
      await load()
    })

  const remove = (device: PairedDevice) =>
    act(`remove:${device.id}`, async () => {
      await revokePairedDevice(target, device.id)
      setConfirmingId(null)
      if (shownCode?.deviceId === device.id) setShownCode(null)
      await load()
    })

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13px] font-semibold text-ink-2">{text.pairedPhones}</span>
      {shownCode && <PairingCode pairing={shownCode} onHide={() => setShownCode(null)} />}
      {devices !== null && devices.length === 0 && <span className="text-[13px] text-body">{text.noPhonesYet}</span>}
      {devices !== null && devices.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2.5">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{device.name}</span>
                  <span className="text-[13px] text-body">
                    {text.pairedWhen(describeTimeAgo(isoFromMs(device.pairedAtMs)))} · {device.lastUsedAtMs === null ? text.notUsedYet : text.lastUsedWhen(describeTimeAgo(isoFromMs(device.lastUsedAtMs)))}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {device.canShowCode && shownCode?.deviceId !== device.id && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`show:${device.id}`, async () => setShownCode(await showDevicePairing(target, device.id)))}>
                      {text.showCode}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setConfirmingId(device.id)}>
                    {text.remove}
                  </Button>
                </span>
              </span>
              {confirmingId === device.id && (
                <span role="alertdialog" aria-label={text.removePhone} className="flex flex-wrap items-center gap-2 rounded-lg border border-danger-line bg-danger-tint px-3 py-2">
                  <span className="min-w-0 flex-[1_1_200px] text-[13px] text-danger-deep">{text.removeQuestion(device.name)}</span>
                  <Button size="sm" variant="danger" className="bg-danger !text-inverse hover:bg-danger-deep" disabled={busy !== null} onClick={() => void remove(device)}>
                    {busy === `remove:${device.id}` ? text.removing : text.removePhone}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirmingId(null)}>
                    {text.keepIt}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isNaming ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void pair()
          }}
        >
          <label htmlFor={nameId} className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5 text-[13px] text-ink-2">
            {text.phoneNameLabel}
            <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} placeholder={text.phoneNamePlaceholder} maxLength={60} autoFocus className="box-border h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink" />
          </label>
          <Button size="sm" type="submit" disabled={busy !== null || !name.trim()}>
            {busy === 'pair' ? text.pairing : text.pair}
          </Button>
          <Button size="sm" variant="ghost" type="button" disabled={busy !== null} onClick={() => setIsNaming(false)}>
            {text.cancel}
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="secondary" className="w-fit" onClick={() => setIsNaming(true)}>
          {text.pairAPhone}
        </Button>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
