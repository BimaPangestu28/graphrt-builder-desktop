import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, LogoMark } from '@/components/ui'
import { formatCountdown, initialSecondsUntilRefresh, pairingCodeLifetimeSeconds } from '@/data/whatsAppPairing'
import { routePaths } from '@/routes'
import { LockIcon } from './agent-builder/LockIcon'
import { PairingQrCode } from './agent-builder/PairingQrCode'

/** Counts down once a second and starts a fresh code (new pattern, full lifetime) when it hits zero. */
function usePairingCodeCountdown() {
  const [pairingCode, setPairingCode] = useState({ secondsUntilRefresh: initialSecondsUntilRefresh, refreshCount: 0 })

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPairingCode(({ secondsUntilRefresh, refreshCount }) =>
        secondsUntilRefresh <= 1
          ? { secondsUntilRefresh: pairingCodeLifetimeSeconds, refreshCount: refreshCount + 1 }
          : { secondsUntilRefresh: secondsUntilRefresh - 1, refreshCount },
      )
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  return pairingCode
}

/** Dimmed, decorative outline of the builder that sits behind the dialog. */
function BuilderBackdropSkeleton() {
  return (
    <>
      <div aria-hidden="true" className="box-border flex flex-[1_1_232px] flex-col gap-[18px] px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-1.5">
          <LogoMark size={28} />
          <span className="text-[18px] font-bold">graphrt</span>
        </div>
        <div className="h-10 rounded-[10px] bg-ink" />
        <div className="h-[120px] rounded-[10px] bg-selected" />
        <div className="h-14 rounded-[10px] bg-brand-soft" />
      </div>
      <div aria-hidden="true" className="flex flex-[999_1_560px] flex-wrap">
        <div className="flex-[1_1_380px] border-r border-line bg-surface" />
        <div className="box-border flex flex-[1_1_440px] flex-col gap-2 bg-subtle px-6 py-[88px]">
          {[0, 1, 2, 3].map((placeholderIndex) => (
            <div key={placeholderIndex} className="h-[54px] rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>
    </>
  )
}

function PairingInstructions() {
  return (
    <>
      <ol className="m-0 flex flex-col gap-2.5 pl-5 leading-normal">
        <li>Open WhatsApp on your phone</li>
        <li>
          Go to <b className="font-semibold">Settings</b> then <b className="font-semibold">Linked devices</b>
        </li>
        <li>
          Tap <b className="font-semibold">Link a device</b> and scan this code
        </li>
      </ol>
      <div className="flex flex-col gap-1.5 rounded-xl bg-amber-soft px-4 py-3.5 leading-normal text-amber-deep">
        <span className="font-semibold text-amber-strong">Use a separate number for outreach</span>
        <span className="text-[13px]">
          This links like WhatsApp Web, not the official business API. Messaging many strangers can get a number banned, so graphrt keeps a 30 second gap and a daily limit
        </span>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <LockIcon />
        The session stays on this Mac. It is never uploaded
      </div>
    </>
  )
}

/**
 * Screen 05 · Connect WhatsApp. Modal opened from the builder's "Connect" button:
 * a pairing QR code that refreshes on a countdown, steps to link a device, and a warning
 * about outreach numbers. Close (or Escape) returns to the builder (04).
 */
export function ConnectWhatsAppPage() {
  const navigate = useNavigate()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const { secondsUntilRefresh, refreshCount } = usePairingCodeCountdown()
  const closeDialog = useCallback(() => navigate(routePaths.builder), [navigate])

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDialog])

  return (
    <div className="relative box-border flex min-h-screen w-full flex-wrap bg-canvas text-[14px] text-ink">
      <BuilderBackdropSkeleton />
      <div className="absolute inset-0 box-border flex items-center justify-center bg-[rgba(24,24,27,0.45)] p-6">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-title"
          className="box-border flex w-full max-w-[760px] flex-wrap gap-8 rounded-[20px] bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
          <div className="flex flex-none flex-col items-center gap-3">
            <PairingQrCode refreshCount={refreshCount} />
            <span role="status" className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="box-border size-3.5 animate-spin rounded-full border-2 border-brand border-r-brand-line motion-reduce:animate-none" />
              Waiting for scan · code refreshes in {formatCountdown(secondsUntilRefresh)}
            </span>
          </div>

          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="wa-title" className="m-0 text-[24px] font-semibold">
                Connect WhatsApp
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close"
                onClick={closeDialog}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <PairingInstructions />
          </div>
        </section>
      </div>
    </div>
  )
}
