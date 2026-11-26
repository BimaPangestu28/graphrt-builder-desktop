import { Badge, Button, type BadgeTone } from '@/components/ui'
import { qrLoginTimeoutSeconds, useWhatsAppWebSession, type WhatsAppWebStatus } from './useWhatsAppActions'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** The button label users look for: linking is a QR scan, nothing to type. */
export function linkWhatsAppButtonLabel(): string {
  return messages().chatbot.linkButton
}

type LinkState = 'checking' | 'linked' | 'not_linked' | 'starting' | 'unknown'

function readLinkState(pendingAction: string | null, sessionStatus: WhatsAppWebStatus | null): LinkState {
  if (pendingAction === 'checking' && !sessionStatus) return 'checking'
  if (!sessionStatus) return 'unknown'
  if (sessionStatus.status === 'logged_in') return 'linked'
  if (sessionStatus.status === 'needs_login') return 'not_linked'
  if (sessionStatus.status === 'loading') return 'starting'
  return 'unknown'
}

const linkStateLabels: Readonly<Record<LinkState, string>> = localizedRecord(() => messages().chatbot.linkStates)

const linkStateTones: Record<LinkState, BadgeTone> = { checking: 'neutral', linked: 'ok', not_linked: 'amber', starting: 'neutral', unknown: 'neutral' }

function describeSessionDetails(sessionStatus: WhatsAppWebStatus | null): string | null {
  if (!sessionStatus) return null
  const details = [sessionStatus.message, sessionStatus.sendsToday !== null ? messages().chatbot.sendstodaySentToday(sessionStatus.sendsToday) : null].filter(Boolean)
  return details.length > 0 ? details.join(' · ') : null
}

/**
 * Links a personal WhatsApp to the trusted `whatsapp-web` plugin: whether it is linked
 * (checked on mount), "Link WhatsApp (scan QR code)" which opens the plugin's QR window,
 * and "Refresh status". Render only once the plugin is installed and trusted and the
 * browser runtime is ready. Used on screen 05, the whatsapp-web plugin page and the build chat.
 *
 * @param props.onSessionChange - Called after each link or status check, e.g. to reload the plugin requirements (() => void)
 */
export function WhatsAppWebLinkPanel({ onSessionChange }: { onSessionChange?: () => unknown } = {}) {
  const session = useWhatsAppWebSession({ checksOnMount: true, onSessionChange })
  const isBusy = session.pendingAction !== null
  const linkState = readLinkState(session.pendingAction, session.sessionStatus)
  const sessionDetails = describeSessionDetails(session.sessionStatus)

  return (
    <section aria-label={messages().chatbot.linkWhatsapp} className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2.5">
      <span role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        {'WhatsApp: '}
        <Badge tone={linkStateTones[linkState]}>{linkStateLabels[linkState]}</Badge>
        {sessionDetails && <span className="text-[12px] text-muted">{` · ${sessionDetails}`}</span>}
      </span>
      <span className="text-[13px] leading-normal text-body">
        {messages().chatbot.aWindowWithAQrCode}{' '}<b className="font-semibold">{messages().chatbot.settings}</b> → <b className="font-semibold">{messages().chatbot.linkedDevices}</b> →{' '}
        <b className="font-semibold">{messages().chatbot.linkADevice}</b>{messages().chatbot.thenScanItWithin}{' '}{qrLoginTimeoutSeconds / 60} {messages().chatbot.minutes}
      </span>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isBusy} onClick={() => void session.showQrCode()}>
          {session.pendingAction === 'linking' ? messages().chatbot.waitingForScan : linkWhatsAppButtonLabel()}
        </Button>
        <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => void session.refreshStatus()}>
          {session.pendingAction === 'checking' ? messages().chatbot.checking : messages().chatbot.refreshStatus}
        </Button>
      </span>
      {session.errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {session.errorMessage}
        </p>
      )}
      <span className="text-[12px] text-muted">{messages().chatbot.theSessionStaysOnThisComputer}</span>
    </section>
  )
}
