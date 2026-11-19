import { Badge, Button, type BadgeTone } from '@/components/ui'
import { qrLoginTimeoutSeconds, useWhatsAppWebSession, type WhatsAppWebStatus } from './useWhatsAppActions'

/** The button label users look for: linking is a QR scan, nothing to type. */
export const linkWhatsAppButtonLabel = 'Link WhatsApp (scan QR code)'

type LinkState = 'checking' | 'linked' | 'not_linked' | 'starting' | 'unknown'

function readLinkState(pendingAction: string | null, sessionStatus: WhatsAppWebStatus | null): LinkState {
  if (pendingAction === 'checking' && !sessionStatus) return 'checking'
  if (!sessionStatus) return 'unknown'
  if (sessionStatus.status === 'logged_in') return 'linked'
  if (sessionStatus.status === 'needs_login') return 'not_linked'
  if (sessionStatus.status === 'loading') return 'starting'
  return 'unknown'
}

const linkStateLabels: Record<LinkState, string> = {
  checking: 'Checking…',
  linked: 'Linked',
  not_linked: 'Not linked',
  starting: 'Starting, refresh in a moment',
  unknown: 'Unknown',
}

const linkStateTones: Record<LinkState, BadgeTone> = { checking: 'neutral', linked: 'ok', not_linked: 'amber', starting: 'neutral', unknown: 'neutral' }

function describeSessionDetails(sessionStatus: WhatsAppWebStatus | null): string | null {
  if (!sessionStatus) return null
  const details = [sessionStatus.message, sessionStatus.sendsToday !== null ? `${sessionStatus.sendsToday} sent today` : null].filter(Boolean)
  return details.length > 0 ? details.join(' · ') : null
}

/**
 * Links a personal WhatsApp to the trusted `whatsapp-web` plugin: whether it is linked
 * (checked on mount), "Link WhatsApp (scan QR code)" which opens the plugin's QR window,
 * and "Refresh status". Render only once the plugin is installed and trusted and the
 * browser runtime is ready. Used on screen 05, the Connections plugin card and the build chat.
 *
 * @param props.onSessionChange - Called after each link or status check, e.g. to reload the plugin requirements (() => void)
 */
export function WhatsAppWebLinkPanel({ onSessionChange }: { onSessionChange?: () => unknown } = {}) {
  const session = useWhatsAppWebSession({ checksOnMount: true, onSessionChange })
  const isBusy = session.pendingAction !== null
  const linkState = readLinkState(session.pendingAction, session.sessionStatus)
  const sessionDetails = describeSessionDetails(session.sessionStatus)

  return (
    <section aria-label="Link WhatsApp" className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2.5">
      <span role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        {'WhatsApp: '}
        <Badge tone={linkStateTones[linkState]}>{linkStateLabels[linkState]}</Badge>
        {sessionDetails && <span className="text-[12px] text-muted">{` · ${sessionDetails}`}</span>}
      </span>
      <span className="text-[13px] leading-normal text-body">
        A window with a QR code opens. On your phone: WhatsApp → <b className="font-semibold">Settings</b> → <b className="font-semibold">Linked devices</b> →{' '}
        <b className="font-semibold">Link a device</b>, then scan it within {qrLoginTimeoutSeconds / 60} minutes.
      </span>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isBusy} onClick={() => void session.showQrCode()}>
          {session.pendingAction === 'linking' ? 'Waiting for scan…' : linkWhatsAppButtonLabel}
        </Button>
        <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => void session.refreshStatus()}>
          {session.pendingAction === 'checking' ? 'Checking…' : 'Refresh status'}
        </Button>
      </span>
      {session.errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {session.errorMessage}
        </p>
      )}
      <span className="text-[12px] text-muted">The session stays on this computer. It is never uploaded</span>
    </section>
  )
}
