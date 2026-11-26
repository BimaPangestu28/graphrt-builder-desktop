import type { InstalledPlugin } from '@/api/pluginTypes'
import { whatsAppWebPluginName } from '../connect-whatsapp/useWhatsAppActions'
import { WhatsAppWebLinkPanel } from '../connect-whatsapp/WhatsAppWebLinkPanel'
import { messages } from '@/i18n'

/**
 * `whatsapp-web` links by QR code, nothing to type: the link panel once the plugin is trusted
 * and the browser runtime is ready, else what is left to do. Renders nothing for other plugins.
 */
export function WhatsAppWebLinkSection({ installed, isBrowserReady }: { installed: InstalledPlugin; isBrowserReady: boolean }) {
  if (installed.name !== whatsAppWebPluginName) return null
  if (!installed.trusted) return <span className="text-[13px] text-ink-2">{messages().plugins.trustThenLink}</span>
  if (!isBrowserReady) return <span className="text-[13px] text-ink-2">{messages().plugins.installBrowserThenLink}</span>
  return <WhatsAppWebLinkPanel />
}
