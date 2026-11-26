import { Badge, Button } from '@/components/ui'
import { useWhatsAppWebSession } from '../connect-whatsapp/useWhatsAppActions'
import { linkWhatsAppButtonLabel } from '../connect-whatsapp/WhatsAppWebLinkPanel'
import { messages } from '@/i18n'

interface PluginSessionLinkActionProps {
  /** The "Needs" row label, used to name the button for screen readers. */
  label: string
  /** Called after the QR login ends, so the requirements reload and the row can flip to "Ready". */
  onSessionChange?: () => unknown
}

/**
 * Right side of a "Needs" row for whatsapp-web when only the QR link is missing: "Not linked"
 * and "Link WhatsApp (scan QR code)", which opens the plugin's QR window and waits for the scan.
 */
export function PluginSessionLinkAction({ label, onSessionChange }: PluginSessionLinkActionProps) {
  const session = useWhatsAppWebSession({ onSessionChange })
  const isLinking = session.pendingAction === 'linking'
  return (
    <span className="flex flex-col items-end gap-1.5">
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone="amber">{messages().builder.notLinked}</Badge>
        <Button size="sm" aria-label={messages().builder.linkwhatsappbuttonlabelForLabel(linkWhatsAppButtonLabel, label)} disabled={session.pendingAction !== null} onClick={() => void session.showQrCode()}>
          {isLinking ? messages().builder.waitingForScan : linkWhatsAppButtonLabel}
        </Button>
      </span>
      {session.errorMessage && (
        <span role="alert" className="text-[12px] text-danger">
          {session.errorMessage}
        </span>
      )}
    </span>
  )
}
